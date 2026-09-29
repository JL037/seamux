// The board's write verbs: send a message, interrupt a turn, resume a
// closed chat, and start new sessions (dispatch and fork). All of them go
// through cmux. None of them destroys anything.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  ASKED_IN_REPLY,
  hasPreviews,
  type Answer,
  type Card,
  type Dialog,
  type Question,
} from "./board.ts";
import { forgetCommands } from "./commands.server.ts";
import { parseCodexApproval, renameCodexSession } from "./codex.server.ts";
import { ENGINES, renderMacro, usesVariable, type Engine } from "./config.ts";
import { configOrDefaults } from "./config.server.ts";
import { BIN_DIRS, CMUX_BIN, findBin, SHELL } from "./bins.server.ts";
import { cmuxCli, cmuxRpc } from "./cmux.server.ts";
import { projectOf } from "./project-colors.ts";
import { recordDispatch } from "./store.server.ts";

const run = promisify(execFile);

export interface Surface {
  surfaceId: string;
  workspaceId: string;
}

const rpc = cmuxRpc;

interface CmuxSession {
  session_id: string;
  agent: string;
  active_for_surface: boolean;
  stored_pid_exists: boolean;
  surface_id: string;
  workspace_id: string;
  cwd?: string;
  transcript_path?: string | null;
}

// A session running in a cmux surface, which the board can type into.
export interface LiveSession {
  engine: Engine;
  surface: Surface;
  cwd: string | null;
  // Codex only: cmux records where its transcript is.
  transcript: string | null;
}

// A resumed Codex session stays filed under its old surface until its next
// prompt, so seamux remembers where it resumed it until cmux catches up.
// Kept on globalThis, so a hot reload doesn't forget it.
const codexResumed = ((globalThis as any).__seamuxCodexResumed ??= new Map<
  string,
  Surface
>()) as Map<string, Surface>;

// sessionId -> every live Claude or Codex session cmux hosts. Claude is live
// while cmux marks it active for its surface. Codex never gets that mark,
// so a Codex session is live while its process is.
export async function listLive(): Promise<Map<string, LiveSession>> {
  const stdout = await cmuxCli(["sessions", "list", "--json"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const { sessions } = JSON.parse(stdout) as { sessions: CmuxSession[] };
  const map = new Map<string, LiveSession>();
  for (const s of sessions) {
    if (!s.stored_pid_exists) continue;
    if (s.agent === "claude" && !s.active_for_surface) continue;
    if (s.agent !== "claude" && s.agent !== "codex") continue;
    map.set(s.session_id, {
      engine: s.agent,
      surface: { surfaceId: s.surface_id, workspaceId: s.workspace_id },
      cwd: s.cwd ?? null,
      transcript: s.transcript_path ?? null,
    });
  }
  if (codexResumed.size > 0) {
    const { workspaces } = await rpc<{ workspaces: { id: string }[] }>(
      "workspace.list",
      {},
    );
    for (const [id, surface] of codexResumed) {
      const filed = sessions.find((s) => s.session_id === id);
      if (filed?.surface_id === surface.surfaceId) {
        codexResumed.delete(id);
      } else if (!workspaces.some((w) => w.id === surface.workspaceId)) {
        // Exited before its first prompt: its workspace closed with it.
        codexResumed.delete(id);
        map.delete(id);
      } else {
        map.set(id, { engine: "codex", surface, cwd: null, transcript: null });
      }
    }
  }
  return map;
}

// sessionId -> the cmux surface a live session is running in.
export async function listSurfaces(): Promise<Map<string, Surface>> {
  const live = await listLive();
  return new Map([...live].map(([id, l]) => [id, l.surface]));
}

// Always resolve the surface server-side, and always pass it explicitly:
// cmux defaults to the caller's own surface when none is given.
async function surfaceFor(sessionId: string): Promise<Surface> {
  const surface = (await listSurfaces()).get(sessionId);
  if (!surface)
    throw new Error("This session is not running in a cmux surface");
  return surface;
}

function target(s: Surface) {
  return { surface_id: s.surfaceId, workspace_id: s.workspaceId };
}

// Claude Code folds a long paste into a "[Pasted text #1]" placeholder and
// hands it to the model wrapped in <pasted_content>, so a message for it is
// typed, with Shift+Enter between its lines, since a typed line break
// submits. A tab counts as needing a paste: typed, one would autocomplete.
// Codex is the other way round: it folds long typed input into
// "[Pasted Content N chars]" but shows a paste in full, so it always gets
// one. A separate Enter submits it.
const MUST_PASTE = /[\r\n\t]/;
const LINE_BREAK = /\r\n|\r|\n/;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Claude Code takes typed input arriving faster than about ten characters a
// millisecond for a paste: it drops pieces of it, and an Enter that comes
// while it is still taking it in is lost, leaving the message unsent in its
// prompt box. So text is typed a little at a time.
const TYPE_CHUNK = 100;
const TYPE_GAP_MS = 20;

async function typeText(surface: Surface, text: string) {
  const chars = Array.from(text);
  for (let at = 0; at < chars.length; at += TYPE_CHUNK) {
    if (at) await pause(TYPE_GAP_MS);
    await rpc("surface.send_text", {
      ...target(surface),
      text: chars.slice(at, at + TYPE_CHUNK).join(""),
    });
  }
}

async function enterText(surface: Surface, text: string, paste: boolean) {
  if (paste) await rpc("terminal.paste", { ...target(surface), text });
  else await typeText(surface, text);
}

// The message is still in the prompt box after its Enter.
export class UnsentError extends Error {
  constructor() {
    super(
      "The message is in the chat's prompt box but didn't send; press Enter there",
    );
  }
}

// How long to give Claude Code to take a message in before checking it went,
// and how many more Enters to press when it didn't.
const SUBMIT_WAIT_MS = 300;
const SUBMIT_RETRIES = 3;

export async function sendMessage(sessionId: string, text: string) {
  const live = (await listLive()).get(sessionId);
  if (!live) throw new Error("This session is not running in a cmux surface");
  const { surface, engine } = live;
  if (engine === "codex" || /\t/.test(text)) {
    await enterText(surface, text, true);
  } else {
    for (const [i, line] of text.split(LINE_BREAK).entries()) {
      if (i)
        await rpc("surface.send_key", {
          ...target(surface),
          key: "shift+enter",
        });
      await typeText(surface, line);
    }
  }
  await rpc("surface.send_key", { ...target(surface), key: "enter" });
  if (engine === "claude") await confirmSent(surface, text);
  // New skills on disk: the inputs' slash commands must be listed again.
  if (/^\/reload-skills\b/.test(text)) forgetCommands();
}

// Press Enter again while the message still sits in Claude Code's prompt
// box, and give up with an UnsentError if it stays there.
async function confirmSent(surface: Surface, text: string) {
  for (let tries = 0; ; tries++) {
    await pause(SUBMIT_WAIT_MS);
    if (!endsPromptBox(await readScreen(surface), text)) return;
    if (tries === SUBMIT_RETRIES) throw new UnsentError();
    await rpc("surface.send_key", { ...target(surface), key: "enter" });
  }
}

// Whether Claude Code's prompt box, the lines between the last two rules on
// the screen with "❯" leading the first, ends with the end of `text`. The box
// wraps lines, so whitespace is left out of the comparison.
export function endsPromptBox(screen: string, text: string): boolean {
  const lines = screen.split("\n").map((l) => l.trim());
  const rules = lines.flatMap((l, i) => (/^[─━▔]{8,}/.test(l) ? [i] : []));
  const [top, bottom] = rules.slice(-2);
  if (bottom === undefined || !lines[top + 1]?.startsWith("❯")) return false;
  const box = lines
    .slice(top + 1, bottom)
    .join("")
    .replace(/^❯/, "")
    .replace(/\s+/g, "");
  const tail = text.replace(/\s+/g, "").slice(-20);
  return tail.length > 0 && box.endsWith(tail);
}

// Esc: stops the current turn, keeps the session and its history.
export async function interrupt(sessionId: string) {
  const surface = await surfaceFor(sessionId);
  await rpc("surface.send_key", { ...target(surface), key: "escape" });
}

// Long enough for the question dialog to redraw between keys.
const KEY_GAP_MS = 400;

// Answer an open AskUserQuestion by driving its dialog, so the model gets a
// real answer rather than an interrupted turn. Measured against Claude Code
// 2.1.281 and 2.1.282:
// - a digit picks an option on a single-select question and moves on,
//   submitting outright when there is only one question;
// - on a multi-select question digits toggle, and Tab moves on;
// - the row after the last option is "Type something". On a single-select
//   question its digit puts the cursor in it; on a multi-select one the
//   digit only ticks it, so the cursor walks down to it instead. Pasted text
//   there is taken as the answer and moves on. Typed text, which Claude Code
//   shows in full rather than folded, needs an Enter, or on a multi-select
//   question a Tab down to "Next" and an Enter;
// - a question whose options have previews shows each beside the list, has
//   no "Type something" row, and a digit there only moves the cursor, so an
//   Enter picks. Before it, n opens a note on the option under the cursor,
//   and typed text fills it; the Enter then picks with the note;
// - with several questions, or any multi-select one, a review screen comes
//   last, and 1 submits it.
export async function answerQuestion(
  sessionId: string,
  questions: Question[],
  answers: Answer[],
) {
  const surface = await surfaceFor(sessionId);
  const key = async (k: string) => {
    await rpc("surface.send_key", { ...target(surface), key: k });
    await pause(KEY_GAP_MS);
  };
  const digit = async (n: number) => {
    await rpc("surface.send_text", { ...target(surface), text: String(n) });
    await pause(KEY_GAP_MS);
  };
  for (const [i, q] of questions.entries()) {
    const a = answers[i];
    if ("text" in a) {
      if (q.multiSelect)
        for (let n = 0; n < q.options.length; n++) await key("down");
      else await digit(q.options.length + 1);
      const paste = MUST_PASTE.test(a.text);
      await enterText(surface, a.text, paste);
      await pause(KEY_GAP_MS);
      if (!paste) {
        if (q.multiSelect) await key("tab");
        await key("enter");
      }
    } else if (hasPreviews(q)) {
      await digit(a.picks[0] + 1);
      if (a.notes) {
        await rpc("surface.send_text", { ...target(surface), text: "n" });
        await pause(KEY_GAP_MS);
        await enterText(surface, a.notes, false);
        await pause(KEY_GAP_MS);
      }
      await key("enter");
    } else if (q.multiSelect) {
      for (const pick of a.picks) await digit(pick + 1);
      await key("tab");
    } else {
      await digit(a.picks[0] + 1);
    }
  }
  if (questions.length > 1 || questions.some((q) => q.multiSelect))
    await digit(1);
}

// Answer an open permission prompt. Measured against Claude Code 2.1.281:
// 1 is always "Yes", while "No" moves with the options offered, so a denial
// is Esc, which refuses the call and ends the turn for the user to reply to.
// Codex 0.156.1 approves on `y`, and Esc refuses there too.
export async function answerApproval(
  sessionId: string,
  allow: boolean,
  engine: Engine,
) {
  const surface = await surfaceFor(sessionId);
  if (allow) {
    await rpc("surface.send_text", {
      ...target(surface),
      text: engine === "codex" ? "y" : "1",
    });
  } else {
    await rpc("surface.send_key", { ...target(surface), key: "escape" });
  }
}

async function readScreen(surface: Surface): Promise<string> {
  const { text } = await rpc<{ text: string }>(
    "surface.read_text",
    target(surface),
  );
  return text;
}

const OPTION = /^(?:❯\s*)?([1-9])\.\s+(.+)$/;
// A line made of one box-drawing character: the rule a dialog opens under.
const RULE = /^([▔─━])\1{7,}$/;

// The numbered dialog open at the bottom of the screen, or null. It must
// end on Claude Code's "Esc to cancel" footer, so a numbered list in a
// reply is never mistaken for one.
function parseDialog(screen: string): Dialog | null {
  const lines = screen.split("\n").map((l) => l.trim());
  while (lines.length && !lines.at(-1)) lines.pop();
  if (!/Esc to cancel/.test(lines.at(-1) ?? "")) return null;

  // The options, read upwards from the footer down to option 1; lines
  // between them are their descriptions.
  let at = lines.length - 2;
  while (at >= 0 && !OPTION.test(lines[at])) at--;
  const last = Number(OPTION.exec(lines[at] ?? "")?.[1] ?? 0);
  const options: string[] = [];
  for (; at >= 0 && options.length < last; at--) {
    const m = OPTION.exec(lines[at]);
    if (!m) continue;
    if (Number(m[1]) !== last - options.length) return null;
    options.unshift(m[2].trim());
  }
  if (options.length < 2 || options.length !== last) return null;

  // The dialog's own text, between its rule and option 1.
  const text: string[] = [];
  for (at--; at >= 0 && !RULE.test(lines[at]); at--) {
    if (lines[at]) text.unshift(lines[at]);
  }
  if (text.length === 0) return null;
  const [title, ...detail] = text;
  return {
    title,
    detail,
    options,
    key: [...text, ...options].join("\n"),
  };
}

export async function readDialog(surface: Surface): Promise<Dialog | null> {
  return parseDialog(await readScreen(surface));
}

export async function readCodexApproval(surface: Surface) {
  return parseCodexApproval(await readScreen(surface));
}

// Pick an option in the dialog read as `key`. Measured against Claude Code
// 2.1.281 on /exit's "Background work is running": a digit picks and
// confirms in one go. The screen is read again first, so a digit never
// lands in the prompt box once the dialog has gone.
export async function answerDialog(
  sessionId: string,
  key: string,
  option: number,
) {
  const surface = await surfaceFor(sessionId);
  const dialog = await readDialog(surface);
  if (!dialog || dialog.key !== key)
    throw new Error("That dialog is no longer open");
  if (
    !Number.isInteger(option) ||
    option < 0 ||
    option >= dialog.options.length
  )
    throw new Error("No such option");
  await rpc("surface.send_text", {
    ...target(surface),
    text: String(option + 1),
  });
}

// Close a chat the way the user would: /exit, which Claude Code and Codex both
// take, then close the tab it ran in.
// The conversation is kept, and the card moves to DONE, where it can be
// resumed.
//
// A workspace seamux launched closes itself when the agent exits, but a chat
// the user started by hand leaves its shell behind, so the tab is closed once
// the agent is gone. cmux refuses to close a workspace's last tab, so then
// the workspace goes instead. An agent that has not exited keeps its tab.
const EXIT_WAIT_MS = 10_000;

export async function closeChat(sessionId: string) {
  const surface = await surfaceFor(sessionId);
  await rpc("terminal.paste", { ...target(surface), text: "/exit" });
  await rpc("surface.send_key", { ...target(surface), key: "enter" });

  const deadline = Date.now() + EXIT_WAIT_MS;
  while ((await listSurfaces()).has(sessionId)) {
    if (Date.now() > deadline)
      throw new Error("The chat did not exit, so its tab was left open");
    await pause(500);
  }

  // A workspace closing itself can go between any two of these calls: cmux
  // reports a Codex session over before its process has quite exited.
  try {
    const { workspaces } = await rpc<{ workspaces: { id: string }[] }>(
      "workspace.list",
      {},
    );
    if (!workspaces.some((w) => w.id === surface.workspaceId)) return;
    const { surfaces } = await rpc<{ surfaces: { id: string }[] }>(
      "surface.list",
      { workspace_id: surface.workspaceId },
    );
    if (!surfaces.some((s) => s.id === surface.surfaceId)) return;
    if (surfaces.length > 1) {
      await rpc("surface.close", target(surface));
    } else {
      await rpc("workspace.close", { workspace_id: surface.workspaceId });
    }
  } catch (err) {
    if (!/not_found/.test((err as Error).message)) throw err;
  }
}

// Closing with the close-session macro: the macro goes in as a prompt, and
// the chat exits once that turn ends. Held in memory only, since a restart
// mid-close just leaves the chat open, which loses nothing.
//
// A close is held, leaving the chat open with a note, when the turn never
// starts or never ends, when it ends on a question, or when it leaves
// uncommitted changes or its worktree behind: the session said why in its
// reply, which the user should read before it goes. Closing a held chat
// again exits it without the macro.
export interface Closing {
  state: "cleaning" | "held";
  note: string | null;
  since: number;
}

// The prompt a held chat was last given when it was held, to tell when it
// has taken another turn since. Undefined when the hold had no card to read.
const heldOn = new Map<string, string | null>();

const closing = new Map<string, Closing>();
const CLOSE_POLL_MS = 3000;
const CLOSE_START_MS = 60_000;
const CLOSE_TURN_MS = 30 * 60_000;
// A held note stays on the card this long.
const HELD_VISIBLE_MS = 10 * 60_000;

// A held note goes once the chat is given another prompt, since whatever
// it said no longer holds: the user answered it, and it may have cleaned up.
export function closingState(
  sessionId: string,
  now: { lastPrompt: string | null },
): Closing | null {
  const c = closing.get(sessionId);
  if (c?.state !== "held") return c ?? null;
  const prompt = heldOn.get(sessionId);
  const prompted = prompt !== undefined && now.lastPrompt !== prompt;
  if (prompted || Date.now() - c.since > HELD_VISIBLE_MS) {
    closing.delete(sessionId);
    heldOn.delete(sessionId);
    return null;
  }
  return c;
}

// Stopping the clean-up turn calls the close off.
export function cancelClose(sessionId: string) {
  if (closing.get(sessionId)?.state === "cleaning") closing.delete(sessionId);
}

function hold(sessionId: string, note: string, card?: Card) {
  closing.set(sessionId, { state: "held", note, since: Date.now() });
  if (card) heldOn.set(sessionId, card.lastPrompt);
  else heldOn.delete(sessionId);
}

// The other live sessions under the same repo, in a sentence, so the
// session knows what a repo-wide command would reach.
function describeSiblings(card: Card, cards: Card[]): string {
  const repo = projectOf(card.cwd);
  const others = cards.filter(
    (c) =>
      c.sessionId !== card.sessionId &&
      c.column !== "done" &&
      projectOf(c.cwd) === repo,
  );
  if (others.length === 0) {
    return `No other sessions are live under ${repo} right now.`;
  }
  const where = (c: Card) => {
    const wt = worktreeOf(c.cwd);
    if (wt) return `worktree ${wt.split("/").at(-1)}`;
    return c.cwd === repo ? "the main checkout" : c.cwd;
  };
  const list = others.map((c) => `${c.name} (${where(c)})`);
  const named =
    list.length === 1
      ? list[0]
      : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  const count =
    others.length === 1
      ? "is 1 other session"
      : `are ${others.length} other sessions`;
  return `There ${count} live under ${repo} right now: ${named}.`;
}

// The worktree a directory sits in, if any.
function worktreeOf(cwd: string): string | null {
  return cwd.match(/^.*\/(?:\.claude\/)?worktrees\/[^/]+/)?.[0] ?? null;
}

async function uncommitted(cwd: string): Promise<boolean> {
  if (!existsSync(cwd)) return false;
  try {
    const { stdout } = await run("git", ["-C", cwd, "status", "--porcelain"]);
    return stdout.trim() !== "";
  } catch {
    // Not a git checkout: nothing to lose by exiting.
    return false;
  }
}

// Close an idle chat, running the close-session macro first when one is
// set. `lookup` re-reads the card, since the board is derived per poll.
export async function closeSession(
  card: Card,
  cards: Card[],
  lookup: () => Promise<Card | undefined>,
) {
  const sessionId = card.sessionId;
  const current = closingState(sessionId, card);
  if (current?.state === "cleaning") {
    throw new Error("Already cleaning up before it closes");
  }
  const macro = configOrDefaults().macros.closeSession.text.trim();
  if (!macro || current?.state === "held") {
    closing.delete(sessionId);
    await closeChat(sessionId);
    return;
  }
  const text = renderMacro(macro, {
    cwd: card.cwd,
    repo: projectOf(card.cwd),
    siblings: describeSiblings(card, cards),
  });
  const sentAt = Date.now();
  closing.set(sessionId, { state: "cleaning", note: null, since: sentAt });
  try {
    await sendMessage(sessionId, text);
  } catch (err) {
    closing.delete(sessionId);
    throw err;
  }
  void finishClose(sessionId, sentAt, lookup).catch((err: Error) => {
    if (closing.get(sessionId)?.state === "cleaning")
      hold(sessionId, `Not closed: ${err.message}`);
  });
}

async function finishClose(
  sessionId: string,
  sentAt: number,
  lookup: () => Promise<Card | undefined>,
) {
  let started = false;
  for (;;) {
    await pause(CLOSE_POLL_MS);
    // Stopped, or closed another way, in the meantime.
    if (closing.get(sessionId)?.state !== "cleaning") return;
    const card = await lookup();
    if (!card || card.column === "done") {
      closing.delete(sessionId);
      return;
    }
    // The transcript moving on after the paste is the turn starting.
    if ((card.lastActivityAt ?? 0) > sentAt) started = true;
    const waited = Date.now() - sentAt;
    if (!started && waited > CLOSE_START_MS) {
      hold(
        sessionId,
        "The close-session macro never started a turn, so it was left open",
        card,
      );
      return;
    }
    if (waited > CLOSE_TURN_MS) {
      hold(
        sessionId,
        "Clean-up was still running after 30 minutes, so it was left open",
        card,
      );
      return;
    }
    if (!started) continue;
    // A turn that ended by asking the user something wants an answer, not an
    // exit.
    if (card.waiting?.reason === ASKED_IN_REPLY) {
      hold(
        sessionId,
        "Left open: it asked you something. Close again to exit anyway",
        card,
      );
      return;
    }
    // Waiting on a dialog counts as still running.
    if (card.column === "idle") {
      if (await uncommitted(card.cwd)) {
        hold(
          sessionId,
          "Left open: uncommitted changes remain. Close again to exit anyway",
          card,
        );
        return;
      }
      const worktree = worktreeOf(card.cwd);
      if (worktree && existsSync(worktree)) {
        hold(
          sessionId,
          "Left open: its worktree is still there. Close again to exit anyway",
          card,
        );
        return;
      }
      await closeChat(sessionId);
      closing.delete(sessionId);
      return;
    }
  }
}

// Every session seamux starts runs in its own cmux workspace.
//
// cmux runs the command in a zsh login shell that does not read ~/.zshrc,
// so the session would miss the PATH and environment a terminal opened by
// hand gets (npx, pnpm, brew's tools). The command re-runs itself in an
// interactive instance of the user's own shell, which reads its startup
// files. Launch through cmux's own wrapper for the agent, which registers
// the session with cmux (so the board can find its surface), and put the
// agents' install directories first on PATH, in case those files do not.

interface EngineSpec {
  bin: string;
  wrapper: string;
  // The dialog a new folder opens on, the keys that trust it, and what
  // shows once the agent is up, past any dialog.
  trust: { prompt: string; keys: string[] };
  ready: string;
}

// Measured against Claude Code 2.1.281 and codex-cli 0.156.1.
const ENGINE_SPECS: Record<Engine, EngineSpec> = {
  claude: {
    bin: "claude",
    wrapper: join(CMUX_BIN, "cmux-claude-wrapper"),
    // Its default is "No, exit", so Enter alone would refuse.
    trust: { prompt: "Yes, I trust this folder", keys: ["down", "enter"] },
    ready: "Claude Code v",
  },
  codex: {
    bin: "codex",
    wrapper: join(CMUX_BIN, "cmux-codex-wrapper"),
    // Its default is "Trust and continue".
    trust: { prompt: "Trust this folder?", keys: ["enter"] },
    ready: "OpenAI Codex",
  },
};

// Which agents this Mac can launch: cmux's wrapper for it, and the agent
// itself where a launch would look.
export function installedEngines(): Record<Engine, boolean> {
  return Object.fromEntries(
    ENGINES.map((e) => [
      e,
      existsSync(ENGINE_SPECS[e].wrapper) &&
        findBin(ENGINE_SPECS[e].bin) !== null,
    ]),
  ) as Record<Engine, boolean>;
}

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

async function launch(
  engine: Engine,
  cwd: string,
  title: string,
  args: string[],
  focus: boolean,
): Promise<Surface> {
  const spec = ENGINE_SPECS[engine];
  const created = await rpc<{ surface_id: string; workspace_id: string }>(
    "workspace.create",
    {
      cwd,
      title,
      initial_command: `exec ${shq(SHELL)} -ic ${shq(
        [
          `PATH=${BIN_DIRS.map(shq).join(":")}:"$PATH"`,
          shq(spec.wrapper),
          ...args.map(shq),
        ].join(" "),
      )}`,
      focus,
    },
  );
  const surface = {
    surfaceId: created.surface_id,
    workspaceId: created.workspace_id,
  };
  // Not awaited: the dialog, if any, shows up seconds after the launch.
  void acceptTrust(surface, spec).catch(() => {});
  return surface;
}

const TRUST_WAIT_MS = 30_000;

// Both agents stop on a new folder to ask whether the user trusts it, before
// the session exists anywhere the board could see it. Choosing the folder
// to dispatch into is that decision, so seamux answers yes.
async function acceptTrust(surface: Surface, spec: EngineSpec) {
  const deadline = Date.now() + TRUST_WAIT_MS;
  while (Date.now() < deadline) {
    await pause(1000);
    const screen = await readScreen(surface);
    if (screen.includes(spec.trust.prompt)) {
      for (const [i, key] of spec.trust.keys.entries()) {
        if (i > 0) await pause(KEY_GAP_MS);
        await rpc("surface.send_key", { ...target(surface), key });
      }
      return;
    }
    if (screen.includes(spec.ready)) return;
  }
}

// Codex picks its own session id, and cmux files it under the surface once
// the first prompt goes in, a couple of seconds after the folder is
// trusted. Dispatching waits for it, to know which card is the new one.
const CODEX_FILED_MS = 60_000;

async function codexSessionIn(surface: Surface): Promise<string> {
  const deadline = Date.now() + CODEX_FILED_MS;
  while (Date.now() < deadline) {
    await pause(1000);
    for (const [id, live] of await listLive()) {
      if (
        live.engine === "codex" &&
        live.surface.surfaceId === surface.surfaceId
      )
        return id;
    }
  }
  throw new Error(
    "Codex started, but cmux never reported its session. Check its workspace",
  );
}

// A new workspace starts Claude a few seconds after it is created, and
// until then nothing reports the session as live. Remember in-flight
// resumes so a second click in that window cannot start a second process
// on the same conversation.
const RESUME_GUARD_MS = 60_000;
const resuming = new Map<string, number>();

export async function resume(
  sessionId: string,
  cwd: string,
  title: string,
  engine: Engine,
) {
  const now = Date.now();
  const started = resuming.get(sessionId);
  if (started && now - started < RESUME_GUARD_MS) {
    throw new Error("Already resuming this chat");
  }
  // Claim it before the first await, so concurrent requests see the claim.
  resuming.set(sessionId, now);
  try {
    if ((await listSurfaces()).has(sessionId)) {
      throw new Error("This chat is already open in cmux");
    }
    if (engine === "codex") {
      const surface = await launch(
        "codex",
        cwd,
        title,
        ["resume", sessionId],
        true,
      );
      codexResumed.set(sessionId, surface);
    } else {
      await launch("claude", cwd, title, ["--resume", sessionId], true);
    }
  } catch (err) {
    resuming.delete(sessionId);
    throw err;
  }
}

// An open chat renames itself with `/rename`, which Codex takes too, and
// which also retitles its tab.
// cmux's workspace title is its own, so it is set too, but only when the
// chat is the workspace's one tab: otherwise the title covers other chats.
// The rename has happened by then, so a failure there is not reported.
export async function renameLive(sessionId: string, name: string) {
  const surface = await surfaceFor(sessionId);
  await rpc("terminal.paste", { ...target(surface), text: `/rename ${name}` });
  await rpc("surface.send_key", { ...target(surface), key: "enter" });
  try {
    const { surfaces } = await rpc<{ surfaces: { id: string }[] }>(
      "surface.list",
      { workspace_id: surface.workspaceId },
    );
    if (surfaces.length === 1 && surfaces[0].id === surface.surfaceId) {
      await rpc("workspace.rename", {
        workspace_id: surface.workspaceId,
        title: name,
      });
    }
  } catch {}
}

// A closed chat's name lives in its transcript, as the lines `/rename`
// writes; Claude Code reads the last of them when the chat is resumed.
// Appending adds to the transcript and changes nothing already in it. Not
// while a resume is starting, since the new process would write its old
// name back.
//
// Codex keeps names apart from transcripts, in its session index, where
// `/rename` adds a line and the last one wins; seamux adds one the same way.
export async function renameClosed(
  sessionId: string,
  transcript: string,
  name: string,
  engine: Engine,
) {
  const started = resuming.get(sessionId);
  if (started && Date.now() - started < RESUME_GUARD_MS) {
    throw new Error("This chat is resuming; rename it once it is open");
  }
  if (engine === "codex") {
    await renameCodexSession(sessionId, name);
    return;
  }
  await appendFile(
    transcript,
    [
      { type: "custom-title", customTitle: name, sessionId },
      { type: "agent-name", agentName: name, sessionId },
    ]
      .map((line) => JSON.stringify(line) + "\n")
      .join(""),
  );
}

// Brings a stopped background session back in a new cmux workspace, with
// its conversation. `claude attach` restarts it from its job, even when its
// transcript is gone. The wrapper passes subcommands through without
// registering a surface, so the board can show it but not type into it.
export async function attach(
  sessionId: string,
  shortId: string,
  cwd: string,
  title: string,
) {
  const now = Date.now();
  const started = resuming.get(sessionId);
  if (started && now - started < RESUME_GUARD_MS) {
    throw new Error("Already resuming this session");
  }
  resuming.set(sessionId, now);
  try {
    await launch("claude", cwd, title, ["attach", shortId], true);
  } catch (err) {
    resuming.delete(sessionId);
    throw err;
  }
}

// Deleting a background session no open chat owns. seamux never deletes, so
// it dispatches a chat that checks the session and runs `claude rm` itself,
// stopping to ask before discarding unpushed work. The chat starts in the
// session's main checkout, since `claude rm` may remove the worktree the
// session ran in.
export async function askToDelete(orphan: {
  id: string;
  name: string;
  cwd: string;
}): Promise<string> {
  let cwd = orphan.cwd;
  try {
    const { stdout } = await run("git", [
      "-C",
      cwd,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    cwd = dirname(stdout.trim());
  } catch {
    // Not a repository, or already gone: the nearest directory that exists.
    while (!existsSync(cwd) && cwd !== dirname(cwd)) cwd = dirname(cwd);
  }
  return dispatch({
    cwd,
    engine: "claude",
    name: `rm-${orphan.id}`,
    prompt: [
      `Delete the background session ${orphan.id} (${orphan.name}, in ${orphan.cwd}).`,
      `Check it with \`claude agents --json --all\`, then run \`claude rm ${orphan.id}\`.`,
      "If it reports unpushed commits or uncommitted changes, stop and tell me instead of discarding them.",
    ].join(" "),
  });
}

// Any real directory can be dispatched into.
export async function checkDirectory(path: string): Promise<string> {
  if (!path.startsWith("/")) throw new Error("Pick an absolute directory");
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw new Error(`No such directory: ${path}`);
  }
  if (!(await stat(real)).isDirectory())
    throw new Error(`Not a directory: ${path}`);
  return real;
}

// Every name a session or a cmux workspace goes by now. A new session
// takes a name outside it, so no two chats or workspaces share one.
async function namesInUse(): Promise<Set<string>> {
  const [agents, { workspaces }] = await Promise.all([
    run("claude", ["agents", "--json", "--all"], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10_000,
    }).then(
      ({ stdout }) => JSON.parse(stdout) as { name?: string | null }[],
      () => [],
    ),
    rpc<{ workspaces: { title?: string | null }[] }>("workspace.list", {}),
  ]);
  return new Set(
    [...agents.map((a) => a.name), ...workspaces.map((w) => w.title)].filter(
      (n): n is string => !!n,
    ),
  );
}

// What goes on the end of a name to make it free: nothing, else -2, -3, ...
async function freeSuffix(
  taken: (suffix: string) => boolean | Promise<boolean>,
): Promise<string> {
  let suffix = "";
  for (let n = 2; await taken(suffix); n++) suffix = `-${n}`;
  return suffix;
}

// A short, readable name from the first words of a prompt.
export function nameFrom(prompt: string): string {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join("-")
      .slice(0, 40) || "work"
  );
}

const WORKTREE_NAME = /^[a-z0-9][a-z0-9._/-]{0,60}$/;

interface NewWorktree {
  // What went on the end of the name asked for to make it free.
  suffix: string;
  path: string;
  branch: string;
  // The repo's main checkout, which holds every worktree.
  repo: string;
  // Whether the repo already had somewhere for worktrees. Without one, the
  // session is told how this one was set up.
  convention: boolean;
}

// A new worktree for dispatched work, branched from what the chosen checkout
// has checked out now. seamux makes it rather than `claude --worktree`, which
// branches from the remote's default branch (stale when main is unpushed)
// and stops on exit to ask whether to keep the worktree.
//
// It goes in the repo's main checkout, even when the chosen checkout is
// itself a worktree, so worktrees never nest: under .claude/worktrees if
// that exists, else worktrees/. A repo with neither that directory nor
// worktrees/ in its ignores has no convention yet, and gets worktrees/.
//
// The same prompt gives the same name, so a name whose worktree or branch
// already exists, or that nameTaken says is taken elsewhere, gets the next
// free number on the end.
async function createWorktree(
  cwd: string,
  name: string,
  nameTaken: (suffix: string) => boolean,
): Promise<NewWorktree> {
  let list: string;
  try {
    ({ stdout: list } = await run("git", [
      "-C",
      cwd,
      "worktree",
      "list",
      "--porcelain",
    ]));
  } catch {
    throw new Error("A new worktree needs a git repository");
  }
  // The main checkout is the first entry git lists, from any worktree.
  const repo = list.split("\n")[0].replace(/^worktree /, "");
  const claudeHome = existsSync(join(repo, ".claude/worktrees"));
  const home = join(repo, claudeHome ? ".claude/worktrees" : "worktrees");
  const convention =
    claudeHome ||
    (await run("git", ["-C", repo, "check-ignore", "-q", "worktrees/"]).then(
      () => true,
      () => false,
    ));
  const taken = async (candidate: string) =>
    existsSync(join(home, candidate)) ||
    (await run("git", [
      "-C",
      repo,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/worktree-${candidate}`,
    ]).then(
      () => true,
      () => false,
    ));
  const suffix = await freeSuffix(
    async (s) => nameTaken(s) || (await taken(name + s)),
  );
  const path = join(home, name + suffix);
  const branch = `worktree-${name}${suffix}`;
  // HEAD as the chosen checkout sees it, not the main checkout's.
  await run("git", ["-C", cwd, "worktree", "add", path, "-b", branch, "HEAD"]);
  return { suffix, path, branch, repo, convention };
}

// The first prompt of a dispatched session: the new-session macro around
// what was typed, with How to worktree when a new worktree needs it. A
// macro customised without {{how_to_worktree}} gets it at the end.
function firstPrompt(prompt: string, cwd: string, wt: NewWorktree | null) {
  const { macros } = configOrDefaults();
  const howTo =
    wt && !wt.convention
      ? renderMacro(macros.howToWorktree.text, {
          worktree: wt.path,
          branch: wt.branch,
          repo: wt.repo,
        }).trim()
      : "";
  let text = macros.newSession.text;
  if (howTo && !usesVariable(text, "how_to_worktree"))
    text += "\n\n{{how_to_worktree}}";
  return renderMacro(text, { prompt, cwd, how_to_worktree: howTo }).trim();
}

// A leading dash would be read as a flag.
const asPrompt = (p: string) => (p.startsWith("-") ? `Task: ${p}` : p);

export interface DispatchInput {
  cwd: string;
  // Claude Code unless given: fan-out workers rely on its hooks and skill.
  engine?: Engine;
  prompt: string;
  name?: string;
  worktree?: string | null;
  dispatchId?: string | null;
  worker?: string | null;
}

// Start new work as its own top-level session, and record why.
export async function dispatch(input: DispatchInput): Promise<string> {
  const cwd = await checkDirectory(input.cwd);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Say what the new session should do");
  const asked = input.name?.trim() || nameFrom(prompt);
  const worktree = input.worktree?.trim() || null;
  if (worktree && !WORKTREE_NAME.test(worktree)) {
    throw new Error("Worktree names are lowercase letters, digits, - . _ /");
  }

  const engine = input.engine ?? "claude";
  // One number makes the session's name, its cmux workspace's and its
  // worktree's all free, so they read the same.
  const inUse = await namesInUse();
  const nameTaken = (suffix: string) => inUse.has(asked + suffix);
  const wt = worktree ? await createWorktree(cwd, worktree, nameTaken) : null;
  const suffix = wt ? wt.suffix : await freeSuffix(nameTaken);
  const name = asked + suffix;
  const where = wt?.path ?? cwd;
  // The session gets the prompt inside the new-session macro; the card
  // shows what was typed.
  const first = asPrompt(firstPrompt(prompt, where, wt));
  const record = (sessionId: string) =>
    recordDispatch({
      session_id: sessionId,
      cwd: where,
      prompt,
      name,
      worktree: wt ? worktree + wt.suffix : null,
      forked_from: null,
      dispatch_id: input.dispatchId ?? null,
      worker: input.worker ?? null,
    });

  // Codex has no --session-id or --name: it picks its id, and titles the
  // session itself after the first turn.
  if (engine === "codex") {
    const surface = await launch("codex", where, name, [first], false);
    const sessionId = await codexSessionIn(surface);
    record(sessionId);
    return sessionId;
  }
  const sessionId = randomUUID();
  record(sessionId);
  await launch(
    "claude",
    where,
    name,
    ["--session-id", sessionId, "--name", name, first],
    false,
  );
  return sessionId;
}

// Split a tangent out of a chat: a new session that starts with the
// parent's full context, leaving the parent untouched.
export async function fork(
  parentId: string,
  cwd: string,
  prompt: string,
): Promise<string> {
  const text = prompt.trim();
  if (!text) throw new Error("Say what the tangent is");
  const sessionId = randomUUID();
  const inUse = await namesInUse();
  const base = nameFrom(text);
  const name = base + (await freeSuffix((s) => inUse.has(base + s)));
  recordDispatch({
    session_id: sessionId,
    cwd,
    prompt: text,
    name,
    worktree: null,
    forked_from: parentId,
    dispatch_id: null,
    worker: null,
  });
  await launch(
    "claude",
    cwd,
    name,
    [
      "--resume",
      parentId,
      "--fork-session",
      "--session-id",
      sessionId,
      "--name",
      name,
      asPrompt(text),
    ],
    false,
  );
  return sessionId;
}
