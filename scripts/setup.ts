// What seamux installs outside itself, so every Claude Code session works
// with the board:
//
// - SubagentStart and SubagentStop hooks in ~/.claude/settings.json, so each
//   session reports its subagents to the store. The file is backed up first.
// - The skills under skills/ in ~/.claude/skills, rendered with the path of
//   the seamux command sessions call (app/lib/paths.server.ts).
//
//   seamux setup        install both, and start doing so again on every run
//   seamux uninstall    remove both, and stop the board until `setup`
//
// The supervisor calls ensureSetup() on every start, so a first run sets
// seamux up and a later one repairs or updates what an upgrade changed,
// quietly when there's nothing to do. After `seamux uninstall` it leaves
// both alone and won't start: .seamux.json records the uninstall.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IS_CHECKOUT,
  packagePath,
  SEAMUX_BIN,
  SEAMUX_HOME,
} from "../app/lib/paths.server.ts";
import { updateRunFile } from "../app/lib/remote.server.ts";
import { HOME_PREFIX, HOOK_SCRIPT, installRuntime } from "./runtime.ts";

// Read when called rather than at import, so a test can point HOME elsewhere.
const settingsFile = () => join(homedir(), ".claude/settings.json");
const skillsDir = () => join(homedir(), ".claude/skills");

const EVENTS = ["SubagentStart", "SubagentStop"];
// Marks a skill as ours, so uninstall never removes one it did not write.
// Unchanged since the first install, so older installs are still recognised.
const MARK = "<!-- installed by seamux: npm run skills:install -->";

// The command that sets seamux up again, in the words of how it runs.
export const SETUP_COMMAND = IS_CHECKOUT
  ? "bin/seamux setup"
  : "npx seamux setup";
const UNINSTALL_COMMAND = IS_CHECKOUT
  ? "bin/seamux uninstall"
  : "npx seamux uninstall";

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command?: string; timeout?: number }[];
}

// Match on the script's name rather than the full command, so an install
// from a moved checkout, or from npm after a checkout, replaces the old entry
// instead of adding a second.
const isOurs = (g: HookGroup) =>
  g.hooks.some((h) =>
    /seamux.*\/subagent-event\.(ts|mjs)$/.test(h.command ?? ""),
  );

let hookCommand: string | null = null;

// Node by full path: sessions started from a login shell that does not read
// ~/.zshrc may not have it on PATH, and the hook would fail silently.
function command(): string {
  if (hookCommand) return hookCommand;
  let node = process.execPath;
  try {
    node =
      execFileSync("/bin/sh", ["-lc", "command -v node"], {
        encoding: "utf8",
        env: process.env,
      }).trim() || node;
  } catch {}
  hookCommand = `${HOME_PREFIX}${node} --no-warnings ${HOOK_SCRIPT}`;
  return hookCommand;
}

function readSettings(): Record<string, unknown> & {
  hooks?: Record<string, HookGroup[]>;
} {
  const file = settingsFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} isn't valid JSON, so seamux left it alone`);
  }
}

function writeSettings(settings: object): string {
  const file = settingsFile();
  const backup = `${file}.seamux-backup`;
  if (existsSync(file)) copyFileSync(file, backup);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return backup;
}

// Whether each event runs exactly our current hook, once.
function hooksCurrent(): boolean {
  const hooks = readSettings().hooks ?? {};
  return EVENTS.every((event) => {
    const ours = (hooks[event] ?? []).filter(isOurs);
    return (
      ours.length === 1 &&
      ours[0].hooks.length === 1 &&
      ours[0].hooks[0].command === command()
    );
  });
}

// Replace our hook entries with the current ones, or with none. Returns what
// changed, for the log.
function writeHooks(install: boolean): string {
  const settings = readSettings();
  const hooks: Record<string, HookGroup[]> = (settings.hooks ??= {});
  for (const event of EVENTS) {
    const groups = (hooks[event] ?? []).filter((g) => !isOurs(g));
    if (install) {
      groups.push({
        hooks: [{ type: "command", command: command(), timeout: 10 }],
      });
    }
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  const backup = writeSettings(settings);
  return install
    ? `the subagent hooks in ${settingsFile()} (backed up to ${backup})`
    : `the subagent hooks from ${settingsFile()} (backed up to ${backup})`;
}

// Each skill's installed file, and what it should hold.
function skills(): { name: string; file: string; body: string }[] {
  const source = packagePath("skills");
  return readdirSync(source).map((name) => ({
    name,
    file: join(skillsDir(), name, "SKILL.md"),
    body: `${readFileSync(join(source, name, "SKILL.md"), "utf8")
      .replaceAll("{{SEAMUX_BIN}}", SEAMUX_BIN)
      .trimEnd()}\n\n${MARK}\n`,
  }));
}

const ours = (file: string) =>
  existsSync(file) && readFileSync(file, "utf8").includes(MARK);

// Install or update each skill that's missing or out of date. One seamux did
// not write is left in place. Returns what changed.
function writeSkills(): string[] {
  const changed: string[] = [];
  for (const skill of skills()) {
    if (existsSync(skill.file) && !ours(skill.file)) continue;
    if (existsSync(skill.file) && readFileSync(skill.file, "utf8") === skill.body)
      continue;
    mkdirSync(dirname(skill.file), { recursive: true });
    writeFileSync(skill.file, skill.body);
    changed.push(`the ${skill.name} skill`);
  }
  return changed;
}

function removeSkills(): string[] {
  const removed: string[] = [];
  for (const skill of skills()) {
    if (!ours(skill.file)) continue;
    rmSync(dirname(skill.file), { recursive: true });
    removed.push(`the ${skill.name} skill`);
  }
  return removed;
}

function readRunFile(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(SEAMUX_HOME, ".seamux.json"), "utf8"));
  } catch {
    return {};
  }
}

// Whether `seamux uninstall` ran, and `seamux setup` hasn't since.
export function uninstalled(): boolean {
  return readRunFile().uninstalled === true;
}

function setUninstalled(on: boolean) {
  mkdirSync(SEAMUX_HOME, { recursive: true });
  updateRunFile(SEAMUX_HOME, { uninstalled: on ? true : undefined });
}

const list = (items: string[]) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

// Install whatever is missing or stale. Returns a line saying what changed,
// or null when everything was already in place.
export function install(): string | null {
  installRuntime();
  const changed: string[] = [];
  if (!hooksCurrent()) changed.push(writeHooks(true));
  changed.push(...writeSkills());
  if (changed.length === 0) return null;
  return `Installed ${list(changed)}. \`${UNINSTALL_COMMAND}\` removes them.`;
}

export function uninstall(): string {
  const removed = [writeHooks(false), ...removeSkills()];
  setUninstalled(true);
  return `Removed ${list(removed)}. The board won't start until \`${SETUP_COMMAND}\`.`;
}

// `seamux setup`: install, and have every run check the setup again.
export function setup(): string {
  setUninstalled(false);
  return install() ?? "seamux is already set up.";
}

export type SetupCheck =
  | { state: "uninstalled" }
  | { state: "ready"; changed: string | null }
  | { state: "failed"; error: string };

// For the supervisor on every start.
export function ensureSetup(): SetupCheck {
  if (uninstalled()) return { state: "uninstalled" };
  try {
    return { state: "ready", changed: install() };
  } catch (err) {
    return { state: "failed", error: (err as Error).message };
  }
}

function main() {
  const [command] = process.argv.slice(2);
  if (command === "setup") {
    console.log(setup());
  } else if (command === "uninstall") {
    console.log(uninstall());
  } else {
    console.error("Usage: setup.ts setup | uninstall");
    process.exit(64);
  }
}

// Run as a command only when it is the entry point: bundled into
// dist/supervise.js, import.meta.url is that file too, so the name decides.
const entry = process.argv[1] ?? "";
if (/[\\/]setup\.[jt]s$/.test(entry) && entry === fileURLToPath(import.meta.url)) {
  main();
}
