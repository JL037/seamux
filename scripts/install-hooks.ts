// Adds (or with --uninstall, removes) the seamux SubagentStart and
// SubagentStop hooks in ~/.claude/settings.json, so every session reports
// its subagents to the store. Idempotent, and it backs the file up first.
//
//   npm run hooks:install
//   npm run hooks:uninstall

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SETTINGS = join(homedir(), ".claude/settings.json");
const HOOK = join(
  dirname(fileURLToPath(import.meta.url)),
  "../hooks/subagent-event.ts",
);
// Node by full path: sessions started from a login shell that does not read
// ~/.zshrc may not have it on PATH, and the hook would fail silently.
const NODE =
  execFileSync("/bin/sh", ["-lc", "command -v node"], {
    encoding: "utf8",
    env: process.env,
  }).trim() || process.execPath;
const COMMAND = `${NODE} --no-warnings ${HOOK}`;
const EVENTS = ["SubagentStart", "SubagentStop"];

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command?: string; timeout?: number }[];
}

const uninstall = process.argv.includes("--uninstall");
const settings = existsSync(SETTINGS)
  ? JSON.parse(readFileSync(SETTINGS, "utf8"))
  : {};
const hooks: Record<string, HookGroup[]> = (settings.hooks ??= {});

// Match on the script's tail rather than the full command, so an install
// from a moved checkout replaces the old entry instead of adding a second.
const isOurs = (g: HookGroup) =>
  g.hooks.some((h) => h.command?.endsWith("seamux/hooks/subagent-event.ts"));

for (const event of EVENTS) {
  const groups = (hooks[event] ?? []).filter((g) => !isOurs(g));
  if (!uninstall) {
    groups.push({
      hooks: [{ type: "command", command: COMMAND, timeout: 10 }],
    });
  }
  if (groups.length) hooks[event] = groups;
  else delete hooks[event];
}
if (Object.keys(hooks).length === 0) delete settings.hooks;

if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.seamux-backup`);
writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);

console.log(
  uninstall
    ? `Removed seamux hooks from ${SETTINGS}`
    : `Installed seamux hooks in ${SETTINGS}:\n  ${EVENTS.join(", ")} -> ${COMMAND}`,
);
console.log(`Backup: ${SETTINGS}.seamux-backup`);
