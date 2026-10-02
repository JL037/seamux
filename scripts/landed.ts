// What `npm run land` last brought into main, for the dev server to replay
// as file changes: its watcher can miss a landing altogether, and then serves
// the old modules until it restarts.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function landedFile(repo: string): string {
  return join(repo, "data", "board.landed");
}

// The files a landing changed, relative to `repo`. The dev server polls this
// file, so each write, even of the same files, is a new landing.
export function recordLanding(repo: string, files: string[]) {
  mkdirSync(join(repo, "data"), { recursive: true });
  writeFileSync(
    landedFile(repo),
    `${JSON.stringify({ at: new Date().toISOString(), files })}\n`,
  );
}

export function readLanding(repo: string): string[] {
  try {
    const { files } = JSON.parse(readFileSync(landedFile(repo), "utf8"));
    return Array.isArray(files)
      ? files.filter((f): f is string => typeof f === "string" && f !== "")
      : [];
  } catch {
    return [];
  }
}
