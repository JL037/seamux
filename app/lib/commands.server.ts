// The slash commands a Claude Code session in a folder accepts: its
// built-ins, skills and MCP prompts, for autocomplete in the board's inputs.
//
// A headless Claude Code started with stream-json input prints the list as
// its first line, before any prompt, so closing its input once that line
// arrives runs no turn. Measured on Claude Code 2.1.282: about two seconds.
// The terminal-only commands (/add-dir, /artifacts and a few more) are not
// in it.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { SlashCommand } from "./board.ts";

const CLAUDE = join(homedir(), ".local/bin/claude");
const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 20_000;

interface Entry {
  at: number;
  commands: Promise<SlashCommand[]>;
}

// cwd -> its list, or the run fetching it. On globalThis so a hot reload
// keeps it.
const cache = ((globalThis as any).__seamuxCommands ??= new Map()) as Map<
  string,
  Entry
>;

export function slashCommands(cwd: string): Promise<SlashCommand[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.commands;
  const commands = listCommands(cwd);
  cache.set(cwd, { at: Date.now(), commands });
  // A failed run is not kept, so the next open tries again.
  commands.catch(() => {
    if (cache.get(cwd)?.commands === commands) cache.delete(cwd);
  });
  return commands;
}

// /reload-skills picks up skills added or changed on disk, which may be
// user-level ones every folder sees, so every folder's list goes.
export function forgetCommands() {
  cache.clear();
}

function listCommands(cwd: string): Promise<SlashCommand[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CLAUDE,
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
      ],
      {
        cwd,
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
        },
      },
    );
    let out = "";
    let done = false;
    const finish = (err: Error | null, commands?: SlashCommand[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (err) reject(err);
      else resolve(commands!);
    };
    const timer = setTimeout(
      () => finish(new Error("Claude Code took too long to list commands")),
      TIMEOUT_MS,
    );
    child.on("error", (err) => finish(err));
    child.on("exit", () =>
      finish(new Error("Claude Code exited without listing commands")),
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      for (let nl = out.indexOf("\n"); nl >= 0; nl = out.indexOf("\n")) {
        const line = out.slice(0, nl);
        out = out.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg?.type === "system" && Array.isArray(msg.commands)) {
          return finish(null, parse(msg.commands));
        }
      }
    });
  });
}

function parse(raw: unknown[]): SlashCommand[] {
  const commands: SlashCommand[] = [];
  for (const c of raw as any[]) {
    if (typeof c?.name !== "string" || !c.name) continue;
    // Claude Code's own plumbing, not for typing.
    if (c.name.startsWith("__")) continue;
    commands.push({
      name: c.name,
      description: typeof c.description === "string" ? c.description : "",
      argumentHint: typeof c.argumentHint === "string" ? c.argumentHint : "",
    });
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}
