// Where the agents, cmux and Node live, for the commands seamux runs and
// the sessions it launches. Imported by drive.server.ts, which
// scripts/seamux.ts runs under plain Node: relative imports with extensions.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// cmux's app bundle, which holds the wrappers that launch each agent. In
// /Applications unless SEAMUX_CMUX_APP says otherwise, or installed for this
// user alone in ~/Applications.
export const CMUX_APP =
  [
    process.env.SEAMUX_CMUX_APP,
    "/Applications/cmux.app",
    join(homedir(), "Applications/cmux.app"),
  ].find((p): p is string => !!p && existsSync(p)) ?? "/Applications/cmux.app";
export const CMUX_BIN = join(CMUX_APP, "Contents/Resources/bin");

// Put first on PATH for everything seamux starts, in case the shell's own
// startup files don't: where Claude Code's installer puts it, the Node this
// server runs on (for bin/seamux, the subagent hook, and a Codex installed
// with npm or pnpm), and Homebrew on Apple silicon and Intel.
export const BIN_DIRS = [
  join(homedir(), ".local/bin"),
  dirname(process.execPath),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

// The first `name` in BIN_DIRS or on PATH, or null when there is none.
export function findBin(name: string): string | null {
  const dirs = [...BIN_DIRS, ...(process.env.PATH ?? "").split(":")].filter(
    // cmux's per-terminal shims forward to its wrappers, not to an agent.
    (d) => d && !d.includes("cmux-cli-shims"),
  );
  for (const d of dirs) {
    if (existsSync(join(d, name))) return join(d, name);
  }
  return null;
}

// The login shell of whoever runs seamux, which new sessions start in so
// they get the PATH and environment a terminal opened by hand gets.
export const SHELL = process.env.SHELL || "/bin/zsh";
