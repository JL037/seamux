import { useEffect, useState } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";

import { THEME_KEY } from "~/components/theme-toggle";
import { DEFAULT_THEME, type ActiveTheme, type ColorMode } from "~/lib/theme";

// The stamp of the last light-or-dark from a swap this browser took. Kept
// in this browser, so one opened after the swap still takes it, and one
// whose toggle has since been flipped isn't flipped back.
export const COLOR_AT_KEY = "seamux:theme-color-at";

// The board's theme, client side. Every theme's CSS comes with the root
// loader, so choosing one is only an attribute on <html>; the active name
// comes with the board's poll, stamped, and a board takes it only when the
// stamp is newer than what it shows, so a late answer never puts an older
// theme back.

declare global {
  interface Window {
    // Set first by root.tsx's inline script, which keeps data-theme on
    // <html> matching it.
    __seamuxTheme?: ActiveTheme;
  }
}

export interface ThemeStyles {
  hash: string;
  css: string;
  active: ActiveTheme;
}

// Whether revalidating should fetch the root loader's CSS again: set while
// the page's CSS is older than the poll's hash, and read, never cleared, by
// root.tsx's shouldRevalidate.
let cssWanted = false;
export function themeCssWanted(): boolean {
  return cssWanted;
}

export function applyActiveTheme(active: ActiveTheme) {
  const shown = window.__seamuxTheme;
  if (shown && shown.updatedAt >= active.updatedAt) return;
  window.__seamuxTheme = active;
  const root = document.documentElement;
  if (active.name === DEFAULT_THEME) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", active.name);
}

// Light or dark from a swap, when it's newer than the last this browser
// took: stored as the header toggle would store it, so the toggle flips it
// back. root.tsx's inline script does the same before the first paint.
export function applyColor(color: ColorMode | null, colorAt: number) {
  if (!color) return;
  try {
    const taken = Number(JSON.parse(localStorage.getItem(COLOR_AT_KEY) ?? "0"));
    if (colorAt <= taken) return;
    const dark = color === "dark";
    if (dark === matchMedia("(prefers-color-scheme: dark)").matches) {
      localStorage.removeItem(THEME_KEY);
    } else {
      localStorage.setItem(THEME_KEY, JSON.stringify(color));
    }
    localStorage.setItem(COLOR_AT_KEY, JSON.stringify(colorAt));
    document.documentElement.classList.toggle("dark", dark);
  } catch {}
}

// Follows the board's theme: from /theme/events as soon as it changes, and
// from the poll, which still carries it if the stream drops. Each source
// can only move the theme and light or dark forward, by their stamps, so
// whichever arrives late changes nothing. Fetches the CSS again when the
// newest hash of the themes differs from the one the page has.
export function useThemeSync(active: ActiveTheme, hash: string) {
  const root = useRouteLoaderData("root") as
    | { themes?: ThemeStyles }
    | undefined;
  const loaded = root?.themes?.hash;
  const revalidator = useRevalidator();
  const [latestHash, setLatestHash] = useState(hash);
  useEffect(() => setLatestHash(hash), [hash]);
  useEffect(() => {
    applyActiveTheme(active);
  }, [active.name, active.updatedAt]);
  useEffect(() => {
    applyColor(active.color, active.colorAt);
  }, [active.color, active.colorAt]);
  useEffect(() => {
    // Reconnects by itself when the stream drops, as on a restart.
    const source = new EventSource("/theme/events");
    source.onmessage = (message) => {
      let event: { active: ActiveTheme; hash: string };
      try {
        event = JSON.parse(message.data as string);
      } catch {
        return;
      }
      applyActiveTheme(event.active);
      applyColor(event.active.color, event.active.colorAt);
      setLatestHash(event.hash);
    };
    return () => source.close();
  }, []);
  useEffect(() => {
    cssWanted = loaded !== undefined && loaded !== latestHash;
    if (!cssWanted) return;
    if (revalidator.state === "idle") void revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestHash, loaded]);
}
