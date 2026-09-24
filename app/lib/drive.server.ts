// The board's write verbs: send a message, interrupt a turn, resume a
// closed chat, and start new sessions (dispatch and fork). All of them go
// through cmux. None of them destroys anything.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { Answer, Question } from "./board.ts";
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

// Close a chat the way Jakob would: /exit, then close the tab it ran in.
// The conversation is kept, and the card moves to DONE, where it can be
// resumed.
//
// A workspace seemux launched closes itself when Claude exits, but a chat
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

// Every session seemux starts runs in its own cmux workspace.
//
// cmux runs the command in a login shell that does not read ~/.zshrc, so
// `claude` is not on its PATH. Launch through cmux's own wrapper, which
// registers the session with cmux (so the board can find its surface), and
// put Claude Code's install directory on PATH for the wrapper to find it.
const CMUX_CLAUDE_WRAPPER =
  "/Applications/cmux.app/Contents/Resources/bin/cmux-claude-wrapper";
const CLAUDE_BIN_DIR = join(homedir(), ".local/bin");
// Node, for bin/seemux and the subagent hook inside the new session: the
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
// to dispatch into is that decision, so seemux answers yes. Enter alone
// would pick the default, "No, exit".
async function acceptTrust(surface: Surface) {
  const deadline = Date.now() + TRUST_WAIT_MS;
  while (Date.now() < deadline) {
    await pause(1000);
    const { stdout: screen } = await run(
      "cmux",
      ["read-screen", "--surface", surface.surfaceId],
      { timeout: 10_000 },
    );
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
// has checked out now. seemux makes it rather than `claude --worktree`, which
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
  const args = ["--session-id", sessionId, "--name", name, asPrompt(prompt)];
  const where = worktree ? await createWorktree(cwd, worktree) : cwd;

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
