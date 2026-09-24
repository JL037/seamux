// The board's write verbs: send a message, interrupt a turn, resume a
// closed chat, and start new sessions (dispatch and fork). All of them go
// through cmux. None of them destroys anything.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  ASKED_IN_REPLY,
  type Answer,
  type Card,
  type Dialog,
  type Question,
} from "./board.ts";
import { renderMacro } from "./config.ts";
import { configOrDefaults } from "./config.server.ts";
import { projectOf } from "./project-colors.ts";
import { recordDispatch } from "./store.server.ts";

const run = promisify(execFile);

export interface Surface {
  surfaceId: string;
  workspaceId: string;
}

async function rpc<T = unknown>(method: string, params: object): Promise<T> {
  const { stdout } = await run(
    "cmux",
    ["rpc", method, JSON.stringify(params)],
    {
      timeout: 10_000,
    },
  );
  return JSON.parse(stdout) as T;
}

interface CmuxSession {
  session_id: string;
  agent: string;
  active_for_surface: boolean;
  stored_pid_exists: boolean;
  surface_id: string;
  workspace_id: string;
}

// sessionId -> the cmux surface a live Claude session is running in.
export async function listSurfaces(): Promise<Map<string, Surface>> {
  const { stdout } = await run("cmux", ["sessions", "list", "--json"], {
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const { sessions } = JSON.parse(stdout) as { sessions: CmuxSession[] };
  const map = new Map<string, Surface>();
  for (const s of sessions) {
    if (s.agent !== "claude" || !s.active_for_surface || !s.stored_pid_exists)
      continue;
    map.set(s.session_id, {
      surfaceId: s.surface_id,
      workspaceId: s.workspace_id,
    });
  }
  return map;
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

// Pasted, so newlines stay inside the message (cmux wraps it in bracketed
// paste), then a separate Enter submits it.
export async function sendMessage(sessionId: string, text: string) {
  const surface = await surfaceFor(sessionId);
  await rpc("terminal.paste", { ...target(surface), text });
  await rpc("surface.send_key", { ...target(surface), key: "enter" });
}

// Esc: stops the current turn, keeps the session and its history.
export async function interrupt(sessionId: string) {
  const surface = await surfaceFor(sessionId);
  await rpc("surface.send_key", { ...target(surface), key: "escape" });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Long enough for the question dialog to redraw between keys.
const KEY_GAP_MS = 400;

// Answer an open AskUserQuestion by driving its dialog, so the model gets a
// real answer rather than an interrupted turn. Measured against Claude Code
// 2.1.281:
// - a digit picks an option on a single-select question and moves on,
//   submitting outright when there is only one question;
// - on a multi-select question digits toggle, and Tab moves on;
// - the digit after the last option is "Type something", and pasted text
//   there is submitted as the answer;
// - with several questions, or any multi-select one, a review screen comes
//   last, and 1 submits it.
export async function answerQuestion(
  sessionId: string,
  questions: Question[],
  answers: Answer[],
) {
  const surface = await surfaceFor(sessionId);
  const digit = async (n: number) => {
    await rpc("surface.send_text", { ...target(surface), text: String(n) });
    await pause(KEY_GAP_MS);
  };
  for (const [i, q] of questions.entries()) {
    const a = answers[i];
    if ("text" in a) {
      await digit(q.options.length + 1);
      await rpc("terminal.paste", { ...target(surface), text: a.text });
      await pause(KEY_GAP_MS);
    } else if (q.multiSelect) {
      for (const pick of a.picks) await digit(pick + 1);
      await rpc("surface.send_key", { ...target(surface), key: "tab" });
      await pause(KEY_GAP_MS);
    } else {
      await digit(a.picks[0] + 1);
    }
  }
  if (questions.length > 1 || questions.some((q) => q.multiSelect))
    await digit(1);
}

// Answer an open permission prompt. Measured against Claude Code 2.1.281:
// 1 is always "Yes", while "No" moves with the options offered, so a denial
// is Esc, which refuses the call and ends the turn for Jakob to reply to.
export async function answerApproval(sessionId: string, allow: boolean) {
  const surface = await surfaceFor(sessionId);
  if (allow) {
    await rpc("surface.send_text", { ...target(surface), text: "1" });
  } else {
    await rpc("surface.send_key", { ...target(surface), key: "escape" });
  }
}

async function readScreen(surface: Surface): Promise<string> {
  const { stdout } = await run(
    "cmux",
    [
      "read-screen",
      "--workspace",
      surface.workspaceId,
      "--surface",
      surface.surfaceId,
    ],
    { timeout: 10_000 },
  );
  return stdout;
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

// Close a chat the way Jakob would: /exit, then close the tab it ran in.
// The conversation is kept, and the card moves to DONE, where it can be
// resumed.
//
// A workspace seamux launched closes itself when Claude exits, but a chat
// Jakob started by hand leaves its shell behind, so the tab is closed once
// Claude is gone. cmux refuses to close a workspace's last tab, so then the
// workspace goes instead. A Claude that has not exited keeps its tab.
const EXIT_WAIT_MS = 10_000;

export async function closeChat(sessionId: string) {
  const surface = await surfaceFor(sessionId);
  await rpc("terminal.paste", { ...target(surface), text: "/exit" });
  await rpc("surface.send_key", { ...target(surface), key: "enter" });

  const deadline = Date.now() + EXIT_WAIT_MS;
  while ((await listSurfaces()).has(sessionId)) {
    if (Date.now() > deadline)
      throw new Error("Claude did not exit, so its tab was left open");
    await pause(500);
  }

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
}

// Closing with the close-session macro: the macro goes in as a prompt, and
// the chat exits once that turn ends. Held in memory only, since a restart
// mid-close just leaves the chat open, which loses nothing.
//
// A close is held, leaving the chat open with a note, when the turn never
// starts or never ends, when it ends on a question, or when it leaves
// uncommitted changes or its worktree behind: the session said why in its
// reply, which Jakob should read before it goes. Closing a held chat again exits it without the macro.
export interface Closing {
  state: "cleaning" | "held";
  note: string | null;
  since: number;
}

const closing = new Map<string, Closing>();
const CLOSE_POLL_MS = 3000;
const CLOSE_START_MS = 60_000;
const CLOSE_TURN_MS = 30 * 60_000;
// A held note stays on the card this long.
const HELD_VISIBLE_MS = 10 * 60_000;

export function closingState(sessionId: string): Closing | null {
  const c = closing.get(sessionId);
  if (c?.state === "held" && Date.now() - c.since > HELD_VISIBLE_MS) {
    closing.delete(sessionId);
    return null;
  }
  return c ?? null;
}

// Stopping the clean-up turn calls the close off.
export function cancelClose(sessionId: string) {
  if (closing.get(sessionId)?.state === "cleaning") closing.delete(sessionId);
}

function hold(sessionId: string, note: string) {
  closing.set(sessionId, { state: "held", note, since: Date.now() });
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
  const current = closingState(sessionId);
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
      );
      return;
    }
    if (waited > CLOSE_TURN_MS) {
      hold(
        sessionId,
        "Clean-up was still running after 30 minutes, so it was left open",
      );
      return;
    }
    if (!started) continue;
    // A turn that ended by asking Jakob something wants an answer, not an
    // exit.
    if (card.waiting?.reason === ASKED_IN_REPLY) {
      hold(
        sessionId,
        "Left open: it asked you something. Close again to exit anyway",
      );
      return;
    }
    // Waiting on a dialog counts as still running.
    if (card.column === "idle") {
      if (await uncommitted(card.cwd)) {
        hold(
          sessionId,
          "Left open: uncommitted changes remain. Close again to exit anyway",
        );
        return;
      }
      const worktree = worktreeOf(card.cwd);
      if (worktree && existsSync(worktree)) {
        hold(
          sessionId,
          "Left open: its worktree is still there. Close again to exit anyway",
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
// cmux runs the command in a login shell that does not read ~/.zshrc, so
// `claude` is not on its PATH. Launch through cmux's own wrapper, which
// registers the session with cmux (so the board can find its surface), and
// put Claude Code's install directory on PATH for the wrapper to find it.
const CMUX_CLAUDE_WRAPPER =
  "/Applications/cmux.app/Contents/Resources/bin/cmux-claude-wrapper";
const CLAUDE_BIN_DIR = join(homedir(), ".local/bin");
// Node, for bin/seamux and the subagent hook inside the new session: the
// same one this server runs on.
const NODE_BIN_DIR = dirname(process.execPath);

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

async function launch(
  cwd: string,
  title: string,
  args: string[],
  focus: boolean,
) {
  const created = await rpc<{ surface_id: string; workspace_id: string }>(
    "workspace.create",
    {
      cwd,
      title,
      initial_command: [
        `PATH=${shq(CLAUDE_BIN_DIR)}:${shq(NODE_BIN_DIR)}:"$PATH"`,
        shq(CMUX_CLAUDE_WRAPPER),
        ...args.map(shq),
      ].join(" "),
      focus,
    },
  );
  // Not awaited: the dialog, if any, shows up seconds after the launch.
  void acceptTrust({
    surfaceId: created.surface_id,
    workspaceId: created.workspace_id,
  }).catch(() => {});
}

const TRUST_PROMPT = "Yes, I trust this folder";
const TRUST_WAIT_MS = 30_000;

// Claude Code stops on a new folder to ask whether Jakob trusts it, before
// the session exists anywhere the board could see it. Choosing the folder
// to dispatch into is that decision, so seamux answers yes. Enter alone
// would pick the default, "No, exit".
async function acceptTrust(surface: Surface) {
  const deadline = Date.now() + TRUST_WAIT_MS;
  while (Date.now() < deadline) {
    await pause(1000);
    const screen = await readScreen(surface);
    if (screen.includes(TRUST_PROMPT)) {
      await rpc("surface.send_key", { ...target(surface), key: "down" });
      await pause(KEY_GAP_MS);
      await rpc("surface.send_key", { ...target(surface), key: "enter" });
      return;
    }
    // Claude Code is up, past any dialog.
    if (screen.includes("Claude Code v")) return;
  }
}

// A new workspace starts Claude a few seconds after it is created, and
// until then nothing reports the session as live. Remember in-flight
// resumes so a second click in that window cannot start a second process
// on the same conversation.
const RESUME_GUARD_MS = 60_000;
const resuming = new Map<string, number>();

export async function resume(sessionId: string, cwd: string, title: string) {
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
    await launch(cwd, title, ["--resume", sessionId], true);
  } catch (err) {
    resuming.delete(sessionId);
    throw err;
  }
}

// An open chat renames itself with `/rename`, which also retitles its tab.
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
export async function renameClosed(
  sessionId: string,
  transcript: string,
  name: string,
) {
  const started = resuming.get(sessionId);
  if (started && Date.now() - started < RESUME_GUARD_MS) {
    throw new Error("This chat is resuming; rename it once it is open");
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
    await launch(cwd, title, ["attach", shortId], true);
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
    name: `rm-${orphan.id}`,
    prompt: [
      `Delete the background session ${orphan.id} (${orphan.name}, in ${orphan.cwd}).`,
      `Check it with \`claude agents --json --all\`, then run \`claude rm ${orphan.id}\`.`,
      "If it reports unpushed commits or uncommitted changes, stop and tell me instead of discarding them.",
    ].join(" "),
  });
}

// Only real directories inside the home folder can be dispatched into.
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
  if (!real.startsWith(`${homedir()}/`)) {
    throw new Error("Directory must be inside your home folder");
  }
  return real;
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

// A new worktree for dispatched work, branched from what the chosen checkout
// has checked out now. seamux makes it rather than `claude --worktree`, which
// branches from the remote's default branch (stale when main is unpushed)
// and stops on exit to ask whether to keep the worktree.
async function createWorktree(cwd: string, name: string): Promise<string> {
  let root: string;
  try {
    ({ stdout: root } = await run("git", [
      "-C",
      cwd,
      "rev-parse",
      "--show-toplevel",
    ]));
  } catch {
    throw new Error("A new worktree needs a git repository");
  }
  root = root.trim();
  const path = join(root, ".claude/worktrees", name);
  if (existsSync(path))
    throw new Error(`A worktree named ${name} already exists`);
  await run("git", [
    "-C",
    root,
    "worktree",
    "add",
    path,
    "-b",
    `worktree-${name}`,
    "HEAD",
  ]);
  return path;
}

// A leading dash would be read as a flag.
const asPrompt = (p: string) => (p.startsWith("-") ? `Task: ${p}` : p);

export interface DispatchInput {
  cwd: string;
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
  const name = input.name?.trim() || nameFrom(prompt);
  const worktree = input.worktree?.trim() || null;
  if (worktree && !WORKTREE_NAME.test(worktree)) {
    throw new Error("Worktree names are lowercase letters, digits, - . _ /");
  }

  const sessionId = randomUUID();
  const where = worktree ? await createWorktree(cwd, worktree) : cwd;
  // The session gets the prompt inside the new-session macro; the card
  // shows what was typed.
  const first = renderMacro(configOrDefaults().macros.newSession.text, {
    prompt,
    cwd: where,
  });
  const args = ["--session-id", sessionId, "--name", name, asPrompt(first)];

  recordDispatch({
    session_id: sessionId,
    cwd: where,
    prompt,
    name,
    worktree,
    forked_from: null,
    dispatch_id: input.dispatchId ?? null,
    worker: input.worker ?? null,
  });
  await launch(where, name, args, false);
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
  const name = nameFrom(text);
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
