// seamux's connection to cmux. Every call goes one of two ways, which are the
// whole contract tests/fake-cmux.ts stands in for:
//
// - The control socket, for anything that acts on cmux or reads it live:
//   `cmuxRpc(method, params)`. seamux speaks cmux's v2 protocol itself rather
//   than shelling out to `cmux rpc`, measured against cmux 0.64.23:
//     request   one line: {"id","method","params"} and "\n". With
//               CMUX_SOCKET_CAPABILITY set (it is, in every cmux terminal),
//               the line is prefixed "_cmux_capability_v1 <token> ".
//     password  with CMUX_SOCKET_PASSWORD set, a first line "auth <password>",
//               answered "OK: Authenticated" or "ERROR: <why>".
//     reply     one line: {"id","ok":true,"result"} or
//               {"id","ok":false,"error":{"code","message"}}.
//   A process cmux didn't start is refused, in cmux's default socket mode,
//   with one line of plain text instead: "Access denied - only processes
//   started inside cmux can connect".
// - The `cmux` command, for `cmux sessions list`, which reads cmux's saved
//   hook records without the socket and works out from them which sessions
//   are live. That logic is cmux's, so seamux asks for its answer.
//
// Imported by drive.server.ts, which scripts/seamux.ts runs under plain Node:
// relative imports with extensions.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { CmuxTrouble } from "./board.ts";
import { CMUX_BIN } from "./bins.server.ts";

const run = promisify(execFile);

const RPC_TIMEOUT_MS = 10_000;
const STATE_DIR = join(homedir(), ".local/state/cmux");

// Where cmux listens: CMUX_SOCKET_PATH, as the cmux command reads it, else
// the path cmux last recorded, else its default.
export function socketPath(): string {
  const env = process.env.CMUX_SOCKET_PATH || process.env.CMUX_SOCKET;
  if (env) return env;
  try {
    const last = readFileSync(join(STATE_DIR, "last-socket-path"), "utf8");
    if (last.trim()) return last.trim();
  } catch {}
  return join(STATE_DIR, "cmux.sock");
}

// A refusal from cmux, with its error code (`not_found`, `method_not_found`,
// …) in the message, so callers can match on it. seamux gives a code of its
// own to the refusals cmux sends as plain text, `access_denied` and
// `password`, and to a socket it can't reach, the system's (`ENOENT`,
// `ECONNREFUSED`).
export class CmuxError extends Error {
  readonly method: string;
  readonly code: string;
  constructor(method: string, code: string, message: string) {
    super(`cmux ${method}: ${message} (${code})`);
    this.method = method;
    this.code = code;
  }
}

// cmux's refusal of a process it didn't start.
const ACCESS_DENIED = /Access denied/;

let nextId = 0;

// Call one v2 method and return its result. Throws a CmuxError when cmux
// refuses it, and an Error when cmux can't be reached or doesn't answer.
export function cmuxRpc<T = unknown>(
  method: string,
  params: object = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = `seamux-${process.pid}-${++nextId}`;
    const capability = process.env.CMUX_SOCKET_CAPABILITY;
    const password = process.env.CMUX_SOCKET_PASSWORD;
    const request =
      (capability ? `_cmux_capability_v1 ${capability} ` : "") +
      JSON.stringify({ id, method, params }) +
      "\n";

    const socket = connect(socketPath());
    let buffer = "";
    let authenticating = Boolean(password);
    let settled = false;
    const finish = (err: Error | null, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value as T);
    };
    const timer = setTimeout(
      () => finish(new Error(`cmux ${method}: no reply`)),
      RPC_TIMEOUT_MS,
    );

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(password ? `auth ${password}\n` : request);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        if (authenticating) {
          if (!line.startsWith("OK")) {
            return finish(
              new CmuxError(
                method,
                ACCESS_DENIED.test(line) ? "access_denied" : "password",
                `refused the socket password: ${line}`,
              ),
            );
          }
          authenticating = false;
          socket.write(request);
          continue;
        }
        let reply: {
          id?: unknown;
          ok?: boolean;
          result?: T;
          error?: { code?: string; message?: string };
        };
        try {
          reply = JSON.parse(line);
        } catch {
          return finish(
            ACCESS_DENIED.test(line)
              ? new CmuxError(method, "access_denied", line)
              : new Error(`cmux ${method}: unreadable reply: ${line}`),
          );
        }
        if (reply.id !== id) continue;
        if (reply.ok) return finish(null, reply.result as T);
        return finish(
          new CmuxError(
            method,
            reply.error?.code ?? "error",
            reply.error?.message ?? "request failed",
          ),
        );
      }
    });
    socket.on("error", (err: NodeJS.ErrnoException) =>
      finish(
        err.code
          ? new CmuxError(method, err.code, err.message)
          : new Error(`cmux ${method}: ${err.message}`),
      ),
    );
    socket.on("close", () =>
      finish(new Error(`cmux ${method}: the socket closed before replying`)),
    );
  });
}

// The `cmux` command, from PATH, else from cmux's app bundle: a terminal
// that isn't cmux's needn't have it on PATH.
function cmuxCommand(): string {
  const bundled = join(CMUX_BIN, "cmux");
  const onPath = (process.env.PATH ?? "")
    .split(":")
    .some((d) => d && existsSync(join(d, "cmux")));
  return onPath || !existsSync(bundled) ? "cmux" : bundled;
}

// The `cmux` command, for what it works out without the socket.
export async function cmuxCli(
  args: string[],
  options: { timeout?: number; maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await run(cmuxCommand(), args, {
    timeout: 10_000,
    ...options,
  });
  return stdout;
}

// Why seamux can't reach cmux, from what reaching it threw, for the board to
// explain. Null when it isn't cmux's doing.
export function cmuxTrouble(err: unknown): CmuxTrouble | null {
  const { code, syscall } = (err ?? {}) as { code?: unknown; syscall?: unknown };
  // The `cmux` command, on neither PATH nor in an app bundle.
  if (code === "ENOENT" && String(syscall).startsWith("spawn"))
    return "not_installed";
  if (code === "access_denied") return "outside_cmux";
  if (code === "password") return "password";
  if (code === "ENOENT" || code === "ECONNREFUSED") return "not_running";
  return null;
}
