// Themes in the store's config table: one row per theme (`theme:<name>`),
// the active theme, and the remote swap's switch. The rows hold
// parsed values (app/lib/theme.ts), so reading them parses nothing.

import { createHash } from "node:crypto";

import { openStore } from "./store.server.ts";
import {
  DEFAULT_THEME,
  isThemeName,
  printThemes,
  variantJson,
  type ActiveTheme,
  type ColorMode,
  type Theme,
} from "./theme.ts";

const PREFIX = "theme:";

function get(key: string): unknown {
  const row = openStore()
    .prepare(`SELECT value FROM config WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

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

function rows(): { key: string; value: string }[] {
  return openStore()
    .prepare(
      `SELECT key, value FROM config WHERE key LIKE 'theme:%' ORDER BY key`,
    )
    .all() as { key: string; value: string }[];
}

// Every saved theme, by name. A row whose name or JSON is broken is left
// out; its values are checked as they're printed.
export function readThemes(): Record<string, Theme> {
  const themes: Record<string, Theme> = {};
  for (const { key, value } of rows()) {
    const name = key.slice(PREFIX.length);
    if (!isThemeName(name)) continue;
    try {
      const theme = JSON.parse(value) as Theme;
      if (theme && typeof theme === "object") themes[name] = theme;
    } catch {}
  }
  return themes;
}

export function saveTheme(name: string, theme: Theme) {
  if (!isThemeName(name)) {
    throw new Error(
      `A theme's name is lowercase letters, digits and dashes, starting with a letter, and not "${DEFAULT_THEME}"`,
    );
  }
  put(`${PREFIX}${name}`, theme);
}

// Removing the active theme puts the board back on seamux's own.
export function removeTheme(name: string) {
  put(`${PREFIX}${name}`, undefined);
  if (readActiveTheme().name === name) setActiveTheme(DEFAULT_THEME);
}

// --- The theme every board shows -----------------------------------------

export function readActiveTheme(): ActiveTheme {
  const saved = get("activeTheme") as Partial<ActiveTheme> | undefined;
  const stamp = (n: unknown) => (typeof n === "number" ? n : 0);
  const updatedAt = stamp(saved?.updatedAt);
  const color =
    saved?.color === "light" || saved?.color === "dark" ? saved.color : null;
  const colorAt = color ? stamp(saved?.colorAt) : 0;
  let name = saved?.name;
  if (typeof name !== "string" || !isThemeName(name)) name = DEFAULT_THEME;
  else {
    const exists = openStore()
      .prepare(`SELECT 1 FROM config WHERE key = ?`)
      .get(`${PREFIX}${name}`);
    if (!exists) name = DEFAULT_THEME;
  }
  return { name, updatedAt, color, colorAt };
}

// Stamps the change, always later than the last one, so a board never
// takes an older answer for a newer one. With `color`, every browser also
// switches to light or dark, until its own toggle switches it back;
// without, light or dark is left as each browser has it.
export function setActiveTheme(
  name: string,
  color?: ColorMode,
): ActiveTheme {
  if (name !== DEFAULT_THEME && !readThemes()[name]) {
    throw new Error("No such theme");
  }
  const before = readActiveTheme();
  const later = (than: number) => Math.max(Date.now(), than + 1);
  const active: ActiveTheme = {
    name,
    updatedAt: later(before.updatedAt),
    color: color ?? before.color,
    colorAt: color ? later(before.colorAt) : before.colorAt,
  };
  put("activeTheme", active);
  return active;
}

// --- The page's stylesheet -------------------------------------------------

let cached: { hash: string; css: string } | null = null;

// Every theme's CSS, and a hash of the rows it came from, which the board's
// poll carries so a browser fetches the CSS again only when it changed.
// Printed only when the rows change.
export function themeStyles(): { hash: string; css: string } {
  const hash = createHash("sha256")
    .update(JSON.stringify(rows()))
    .digest("base64url")
    .slice(0, 16);
  if (cached?.hash !== hash) {
    cached = { hash, css: printThemes(readThemes()) };
  }
  return cached;
}

// --- Remote theme swapping -------------------------------------------------

export interface ThemeSwap {
  on: boolean;
}

export function readThemeSwap(): ThemeSwap {
  const saved = get("themeSwap") as Partial<ThemeSwap> | undefined;
  return { on: saved?.on === true };
}

export function setThemeSwap(on: boolean): ThemeSwap {
  put("themeSwap", on ? { on: true } : undefined);
  return readThemeSwap();
}

// --- What the board's poll carries ---------------------------------------

export interface ThemeStatus {
  active: ActiveTheme;
  // Of the themes' rows: when it changes, the page fetches the CSS again.
  hash: string;
  // For the Themes tab, each variant as the JSON its editor shows.
  themes: { name: string; label: string; light: string; dark: string }[];
  swap: ThemeSwap;
}

export function themeStatus(): ThemeStatus {
  try {
    const swap = readThemeSwap();
    return {
      active: readActiveTheme(),
      hash: themeStyles().hash,
      themes: Object.entries(readThemes()).map(([name, theme]) => ({
        name,
        label: typeof theme.label === "string" ? theme.label : name,
        light: variantJson(theme.light),
        dark: variantJson(theme.dark),
      })),
      swap,
    };
  } catch {
    return {
      active: { name: DEFAULT_THEME, updatedAt: 0, color: null, colorAt: 0 },
      hash: "",
      themes: [],
      swap: { on: false },
    };
  }
}
