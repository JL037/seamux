// Every colour the board shows comes from a token in app/app.css, so a theme
// is a block of tokens and nothing else. A colour written straight into a
// component can't be themed, so none are allowed outside the few places
// listed here.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PROJECT_COLOR_COUNT, storedSlot } from "~/lib/project-colors";
import { THEME_TOKENS } from "~/lib/theme";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");
const css = readFileSync(join(APP, "app.css"), "utf8");

const sources = (readdirSync(APP, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => join(APP, f));

// Files whose colours aren't the board's to theme: the seamux mark, the
// PWA's theme-color meta, the colours a browser kept before projects had
// slots, and the theme module, which prints a theme's colours.
const EXEMPT = new Set([
  "components/seamux-mark.tsx",
  "root.tsx",
  "lib/project-colors.ts",
  "lib/theme.ts",
]);

// A Tailwind palette class (amber-500, sky-400/20), or a colour literal.
const RAW = [
  /\b(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g,
  /#[0-9a-fA-F]{3,8}\b(?=["'\]\s;)])/g,
  /\b(?:oklch|oklab|rgba?|hsla?)\(/g,
  /\btext-white\b/g,
];

describe("theme tokens", () => {
  it("leaves no colour outside app.css", () => {
    const found: string[] = [];
    for (const file of sources) {
      const rel = relative(APP, file);
      if (EXEMPT.has(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const re of RAW) {
          for (const [m] of line.matchAll(re))
            found.push(`${rel}:${i + 1} ${m}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it("defines every project colour slot", () => {
    const slots = [...css.matchAll(/--project-color-(\d+):/g)].map((m) =>
      Number(m[1]),
    );
    expect(slots).toEqual(
      Array.from({ length: PROJECT_COLOR_COUNT }, (_, i) => i + 1),
    );
  });

  it("defines every token the theme maps", () => {
    const missing = [...css.matchAll(/--color-[\w-]+: var\((--[\w-]+)\)/g)]
      .map((m) => m[1])
      .filter((token) => !new RegExp(`^\\s*${token}:`, "m").test(css));
    expect(missing).toEqual([]);
  });

  // A theme may set every token app.css declares, except the ones app.css
  // works out from them and the engines' own colours. A new token in
  // app.css lands here, for a decision on whether a theme may set it.
  it("lets a theme set every token but the engines' and the derived", () => {
    const declared = new Set(
      [...css.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]),
    );
    const settable = [...declared].filter(
      (token) => !/^--(color|radius|font)-|^--engine-/.test(token),
    );
    expect(Object.keys(THEME_TOKENS).sort()).toEqual(settable.sort());
  });

  it("reads a colour kept before slots as its slot", () => {
    expect(storedSlot("oklch(0.64 0.24 25)")).toBe(1);
    expect(storedSlot("oklch(0.66 0.24 354)")).toBe(12);
    expect(storedSlot(7)).toBe(7);
    expect(storedSlot(13)).toBeUndefined();
    expect(storedSlot("#123456")).toBeUndefined();
    expect(storedSlot(undefined)).toBeUndefined();
  });
});
