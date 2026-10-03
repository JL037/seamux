// Themes: what a theme may say, the CSS printed from it, and the swap
// route. A theme's values reach the page inside a <style>, so the tests that
// matter most are the ones where an author tries to get text there.

import { beforeEach, describe, expect, it } from "vitest";

import {
  parseColour,
  parseThemeInput,
  printTheme,
  printThemes,
  variantJson,
  type Theme,
} from "~/lib/theme";
import {
  readActiveTheme,
  readThemes,
  readThemeSwap,
  removeTheme,
  saveTheme,
  setActiveTheme,
  setThemeSwap,
  themeStatus,
  themeStyles,
} from "~/lib/theme.server";
import { openStore } from "~/lib/store.server";
import { action, loader } from "~/routes/theme-swap";

const BRAND = `"--brand-primary": "#f5b301", "--brand-secondary": "#e0661b"`;

function parsed(light: string, dark = ""): Theme {
  const result = parseThemeInput({ label: "Duck", light, dark });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.theme;
}

function errors(light: string, dark = "") {
  const result = parseThemeInput({ label: "Duck", light, dark });
  return result.ok ? [] : result.errors;
}

describe("parsing a theme", () => {
  it("reads every colour form it allows", () => {
    expect(parseColour("#abc")).toEqual({
      space: "hex",
      r: 0xaa,
      g: 0xbb,
      b: 0xcc,
      a: 255,
    });
    expect(parseColour("#11223380")).toMatchObject({ a: 0x80 });
    expect(parseColour("rgb(1 2 3 / 50%)")).toEqual({
      space: "rgb",
      r: 1,
      g: 2,
      b: 3,
      alpha: 0.5,
    });
    expect(parseColour("rgba(1, 2, 3, 0.25)")).toMatchObject({ alpha: 0.25 });
    expect(parseColour("hsl(120deg 50% 25%)")).toMatchObject({
      space: "hsl",
      h: 120,
      s: 50,
      l: 25,
    });
    expect(parseColour("oklch(56% 0.19 272)")).toMatchObject({
      space: "oklch",
      l: 0.56,
      c: 0.19,
      h: 272,
    });
    expect(parseColour("oklab(0.5 -0.1 0.1)")).toMatchObject({ space: "oklab" });
    expect(parseColour("transparent")).toEqual({ space: "transparent" });
  });

  it("refuses anything else a colour could be written as", () => {
    for (const text of [
      "red",
      "var(--brand-primary)",
      "color-mix(in oklch, red, blue)",
      "oklch(from #fff l c h)",
      "url(http://example.com/x.png)",
      "\\75 rl(http://example.com/x.png)",
      "#abc;background:url(x)",
      "#abc}</style><script>alert(1)</script>",
      "rgb(1 2 3 / 4 / 5)",
      "rgb(1 2)",
      "oklch(0.5 0.1 calc(1 + 1))",
      "rgb(1e999 0 0)",
    ]) {
      expect(parseColour(text), text).toBeNull();
    }
  });

  it("refuses a token a theme can't set, and a value of the wrong kind", () => {
    expect(errors(`{${BRAND}, "display": "none"}`)).toEqual([
      "light: not a token a theme can set: display",
    ]);
    expect(errors(`{${BRAND}, "--engine-claude": "#fff"}`)).toEqual([
      "light: not a token a theme can set: --engine-claude",
    ]);
    expect(errors(`{${BRAND}, "--card": "1rem"}`)).toEqual([
      "light.--card: not a colour",
    ]);
    expect(errors(`{${BRAND}, "--radius": "#fff"}`)).toEqual([
      "light.--radius: not a length from 0 to 4rem or 64px",
    ]);
    expect(errors(`{${BRAND}, "--card": 5}`)).toHaveLength(1);
  });

  it("needs a brand in each variant, and at least one variant", () => {
    expect(errors(`{"--brand-primary": "#fff"}`)).toEqual([
      "light.--brand-secondary: required",
    ]);
    expect(errors("", "")).toEqual([
      "a theme needs a light variant, a dark one, or both",
    ]);
    expect(errors("{nope")).toHaveLength(1);
  });

  it("keeps numbers, not the text that was typed", () => {
    const theme = parsed(`{${BRAND}, "--card": "OKLCH(  56%  0.19  272 )"}`);
    expect(theme.light?.["--card"]).toEqual({
      space: "oklch",
      l: 0.56,
      c: 0.19,
      h: 272,
      alpha: 1,
    });
    expect(JSON.parse(variantJson(theme.light))).toEqual({
      "--brand-primary": "#f5b301",
      "--brand-secondary": "#e0661b",
      "--card": "oklch(0.56 0.19 272)",
    });
  });
});

describe("printing a theme", () => {
  it("prints light only outside dark mode, and dark only in it", () => {
    const css = printTheme("duck", parsed(`{${BRAND}, "--radius": "0.5rem"}`));
    expect(css).toBe(
      [
        `:root[data-theme="duck"]:not(.dark){--brand-primary:#f5b301;--brand-secondary:#e0661b;--radius:0.5rem}`,
        `:root[data-theme="duck"].dark{--brand-primary:#f5b301;--brand-secondary:#e0661b}`,
      ].join("\n"),
    );
  });

  it("gives a missing variant the other's brand and nothing more", () => {
    const css = printTheme(
      "duck",
      parsed("", `{${BRAND}, "--card": "#000"}`),
    );
    expect(css).toContain(
      `:root[data-theme="duck"]:not(.dark){--brand-primary:#f5b301;--brand-secondary:#e0661b}`,
    );
    expect(css).toContain(`.dark{--brand-primary:#f5b301;--brand-secondary:#e0661b;--card:#000000}`);
  });

  // A store row written by anything but the save action, with text where
  // numbers belong. Whatever it holds, the CSS gets no text from it.
  it("prints no text from a tampered theme", () => {
    const evil = {
      label: "x",
      light: {
        "--brand-primary": { space: "hex", r: "}</style><script>", g: 0, b: 0, a: 255 },
        "--brand-secondary": { space: "oklch", l: 0.5, c: 0.1, h: "url(x)", alpha: 1 },
        "--card": { space: "url(x)" },
        "--muted": { unit: "rem;background:url(x)", value: 1 },
        "--radius": { unit: "rem", value: 1e300 },
        "--accent": { space: "rgb", r: 1e21, g: -5, b: 2, alpha: 9 },
        "display:none;--x": { space: "transparent" },
      },
    };
    const css = printThemes({ duck: evil, "</style>": evil, Duck: evil });
    expect(css).toBe(
      [
        `:root[data-theme="duck"]:not(.dark){--radius:4rem;--accent:rgb(255 0 2)}`,
        `:root[data-theme="duck"].dark{}`,
      ].join("\n"),
    );
  });
});

describe("themes in the store", () => {
  beforeEach(() => {
    openStore().prepare(`DELETE FROM config`).run();
  });

  it("saves, reads, removes, and refuses a bad name", () => {
    saveTheme("duck", parsed(`{${BRAND}}`));
    expect(Object.keys(readThemes())).toEqual(["duck"]);
    expect(() => saveTheme("seamux", parsed(`{${BRAND}}`))).toThrow();
    expect(() => saveTheme("Duck", parsed(`{${BRAND}}`))).toThrow();
    expect(() => saveTheme("hidden duck", parsed(`{${BRAND}}`))).toThrow();
    removeTheme("duck");
    expect(readThemes()).toEqual({});
  });

  it("stamps each change of the active theme later than the last", () => {
    saveTheme("duck", parsed(`{${BRAND}}`));
    expect(readActiveTheme()).toEqual({ name: "seamux", updatedAt: 0 });
    const first = setActiveTheme("duck");
    const second = setActiveTheme("seamux");
    const third = setActiveTheme("duck");
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(third.updatedAt).toBeGreaterThan(second.updatedAt);
    expect(() => setActiveTheme("goose")).toThrow("No such theme");
  });

  it("puts the board back on seamux when the active theme goes", () => {
    saveTheme("duck", parsed(`{${BRAND}}`));
    setActiveTheme("duck");
    removeTheme("duck");
    expect(readActiveTheme().name).toBe("seamux");
  });

  it("changes the hash only when the themes change", () => {
    const empty = themeStyles();
    expect(themeStyles().hash).toBe(empty.hash);
    saveTheme("duck", parsed(`{${BRAND}}`));
    const one = themeStyles();
    expect(one.hash).not.toBe(empty.hash);
    expect(one.css).toContain(`[data-theme="duck"]`);
    setActiveTheme("duck");
    expect(themeStyles().hash).toBe(one.hash);
  });

  it("hands the swap token only to a page on this Mac", () => {
    setThemeSwap(true);
    expect(themeStatus(true).swap.token).toMatch(/^[\w-]{43}$/);
    expect(themeStatus(false).swap).toEqual({ on: true, token: null });
  });

  it("makes a new token each time swapping turns on, and forgets it off", () => {
    const first = setThemeSwap(true).token;
    const second = setThemeSwap(true).token;
    expect(second).not.toBe(first);
    expect(setThemeSwap(false)).toEqual({ on: false, token: null });
  });
});

describe("the swap route", () => {
  beforeEach(() => {
    openStore().prepare(`DELETE FROM config`).run();
    saveTheme("duck", parsed(`{${BRAND}}`));
  });

  const swap = async (
    fields: Record<string, string>,
    host = "localhost:54321",
    json = false,
  ) => {
    const request = new Request(`http://${host}/theme-swap`, {
      method: "POST",
      headers: {
        host,
        "content-type": json
          ? "application/json"
          : "application/x-www-form-urlencoded",
      },
      body: json
        ? JSON.stringify(fields)
        : new URLSearchParams(fields).toString(),
    });
    try {
      const response = await action({ request } as never);
      return response.status;
    } catch (err) {
      return (err as { init?: { status?: number } }).init?.status;
    }
  };

  it("refuses a GET", () => {
    let status: number | undefined;
    try {
      loader();
    } catch (err) {
      status = (err as { init?: { status?: number } }).init?.status;
    }
    expect(status).toBe(405);
  });

  it("refuses everything while swapping is off", async () => {
    expect(await swap({ name: "duck", token: "x" })).toBe(403);
  });

  it("swaps with the token, by form or JSON", async () => {
    const { token } = setThemeSwap(true);
    expect(await swap({ name: "duck", token: token! })).toBe(204);
    expect(readActiveTheme().name).toBe("duck");
    expect(await swap({ name: "seamux", token: token! }, undefined, true)).toBe(
      204,
    );
    expect(readActiveTheme().name).toBe("seamux");
  });

  it("refuses a wrong token, an unknown theme, and the tunnel", async () => {
    const { token } = setThemeSwap(true);
    expect(await swap({ name: "duck", token: "wrong" })).toBe(403);
    expect(await swap({ name: "duck" })).toBe(403);
    expect(await swap({ name: "goose", token: token! })).toBe(404);
    expect(await swap({ name: "duck", token: token! }, "board.example.com")).toBe(
      403,
    );
    expect(readActiveTheme().name).toBe("seamux");
  });

  it("stops working once swapping is turned off", async () => {
    const { token } = setThemeSwap(true);
    setThemeSwap(false);
    expect(await swap({ name: "duck", token: token! })).toBe(403);
  });
});
