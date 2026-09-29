import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./paths.server";

// Snapshots sent from the Debug tab, beside the store in data/: the latest
// one pretty-printed, and the last few as lines, oldest first.
const DIR = join(DATA_DIR, "diagnostics");
const KEEP = 50;

export function saveDiagnostics(entry: Record<string, unknown>) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, "latest.json"), JSON.stringify(entry, null, 2));
  const log = join(DIR, "log.jsonl");
  let lines: string[] = [];
  try {
    lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {}
  lines.push(JSON.stringify(entry));
  writeFileSync(log, lines.slice(-KEEP).join("\n") + "\n");
}
