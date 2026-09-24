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

// Close a chat the way Jakob would: /exit. The conversation is kept, and
// the card moves to DONE, where it can be resumed.
export async function closeChat(sessionId: string) {
  await sendMessage(sessionId, "/exit");
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
  await rpc("workspace.create", {
    cwd,
    title,
    initial_command: [
      `PATH=${shq(CLAUDE_BIN_DIR)}:${shq(NODE_BIN_DIR)}:"$PATH"`,
      shq(CMUX_CLAUDE_WRAPPER),
      ...args.map(shq),
    ].join(" "),
    focus,
  });
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
