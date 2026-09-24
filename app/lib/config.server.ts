// Reads and writes the config table. Imported by drive.server.ts, which
// scripts/seemux.ts runs under plain Node: relative imports with extensions.

import {
  DEFAULT_CONFIG,
  DEFAULT_MACROS,
  MACRO_NAMES,
  MACROS,
  MAX_MACRO,
  usesVariable,
  type Config,
  type MacroName,
} from "./config.ts";
import { openStore } from "./store.server.ts";

function get<T>(key: string, fallback: T): T {
  const row = openStore()
    .prepare(`SELECT value FROM config WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

// `undefined` removes the key, putting the setting back to its default.
function put(key: string, value: unknown) {
  const store = openStore();
  if (value === undefined) {
    store.prepare(`DELETE FROM config WHERE key = ?`).run(key);
    return;
  }
  store
    .prepare(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, JSON.stringify(value));
}

export function readConfig(): Config {
  const macros = { ...DEFAULT_CONFIG.macros };
  for (const name of MACRO_NAMES) {
    const text = get<string | null>(`macro:${name}`, null);
    if (typeof text === "string") macros[name] = { text, custom: true };
  }
  return {
    directories: get("directories", DEFAULT_CONFIG.directories),
    worktreeByDefault: get(
      "worktreeByDefault",
      DEFAULT_CONFIG.worktreeByDefault,
    ),
    macros,
  };
}

// The config, or the defaults when the store can't be read, so a broken
// store never stops a dispatch or the board.
export function configOrDefaults(): Config {
  try {
    return readConfig();
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function addDirectory(path: string) {
  const dirs = new Set(readConfig().directories);
  dirs.add(path);
  put("directories", [...dirs].sort());
}

export function removeDirectory(path: string) {
  const dirs = readConfig().directories.filter((d) => d !== path);
  put("directories", dirs.length > 0 ? dirs : undefined);
}

export function setWorktreeByDefault(on: boolean) {
  put(
    "worktreeByDefault",
    on === DEFAULT_CONFIG.worktreeByDefault ? undefined : on,
  );
}

export function isMacroName(name: string): name is MacroName {
  return (MACRO_NAMES as readonly string[]).includes(name);
}

// `null` puts the macro back to its default.
export function setMacro(name: MacroName, text: string | null) {
  if (text === null || text === DEFAULT_MACROS[name]) {
    put(`macro:${name}`, undefined);
    return;
  }
  if (text.length > MAX_MACRO) throw new Error("That macro is too long");
  const required = MACROS[name].required;
  if (required && !usesVariable(text, required)) {
    throw new Error(`The ${MACROS[name].label} macro needs {{${required}}}`);
  }
  put(`macro:${name}`, text);
}
