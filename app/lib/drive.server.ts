// The board's write verbs: send a message, interrupt a turn, resume a closed
// chat. All of them go through cmux, into the surface that hosts the
// session. None of them destroys anything.

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

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

// Reopen a closed chat in a new cmux workspace in its own directory.
//
// cmux runs the command in a login shell that does not read ~/.zshrc, so
// `claude` is not on its PATH. Launch through cmux's own wrapper, which
// registers the session with cmux (so the board can find its surface), and
// put Claude Code's install directory on PATH for the wrapper to find it.
const CMUX_CLAUDE_WRAPPER =
  "/Applications/cmux.app/Contents/Resources/bin/cmux-claude-wrapper";
const CLAUDE_BIN_DIR = join(homedir(), ".local/bin");

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

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
    await rpc("workspace.create", {
      cwd,
      title,
      initial_command: `PATH=${shq(CLAUDE_BIN_DIR)}:"$PATH" ${shq(CMUX_CLAUDE_WRAPPER)} --resume ${shq(sessionId)}`,
      focus: true,
    });
  } catch (err) {
    resuming.delete(sessionId);
    throw err;
  }
}
