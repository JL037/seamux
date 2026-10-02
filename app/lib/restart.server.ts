// Asking the supervisor (scripts/supervise.ts) to restart the board: it polls
// data/board.restart and restarts the board server whenever its mtime moves.
// `npm run land` asks after a landing that hot reload can't take, and the
// /restart page asks from a browser the board's own scripts no longer work in.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function restartFile(repo: string): string {
  return join(repo, "data", "board.restart");
}

export function requestRestart(repo: string) {
  mkdirSync(join(repo, "data"), { recursive: true });
  writeFileSync(restartFile(repo), `${new Date().toISOString()}\n`);
}
