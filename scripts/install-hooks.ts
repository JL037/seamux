// Adds (or with --uninstall, removes) the seamux SubagentStart and
// SubagentStop hooks in ~/.claude/settings.json, so every session reports
// its subagents to the store. Idempotent, and it backs the file up first.
//
//   npm run hooks:install      (or `seamux setup`)
//   npm run hooks:uninstall    (or `seamux uninstall`)

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { HOME_PREFIX, HOOK_SCRIPT, installRuntime } from "./runtime.ts";

const SETTINGS = join(homedir(), ".claude/settings.json");
// Node by full path: sessions started from a login shell that does not read
// ~/.zshrc may not have it on PATH, and the hook would fail silently.
const NODE =
  execFileSync("/bin/sh", ["-lc", "command -v node"], {
    encoding: "utf8",
    env: process.env,
  }).trim() || process.execPath;
const COMMAND = `${HOME_PREFIX}${NODE} --no-warnings ${HOOK_SCRIPT}`;
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

// Match on the script's name rather than the full command, so an install
// from a moved checkout, or from npm after a checkout, replaces the old entry
// instead of adding a second.
const isOurs = (g: HookGroup) =>
  g.hooks.some((h) =>
    /seamux.*\/subagent-event\.(ts|mjs)$/.test(h.command ?? ""),
  );

if (!uninstall) installRuntime();

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
mkdirSync(dirname(SETTINGS), { recursive: true });
writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);

console.log(
  uninstall
    ? `Removed seamux hooks from ${SETTINGS}`
    : `Installed seamux hooks in ${SETTINGS}:\n  ${EVENTS.join(", ")} -> ${COMMAND}`,
);
console.log(`Backup: ${SETTINGS}.seamux-backup`);
