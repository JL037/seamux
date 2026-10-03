import { useEffect } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";

import { DEFAULT_THEME, type ActiveTheme } from "~/lib/theme";

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

// Follows the poll: shows the active theme, and fetches the CSS again when
// the poll's hash of the themes differs from the one the page has.
export function useThemeSync(active: ActiveTheme, hash: string) {
  const root = useRouteLoaderData("root") as
    | { themes?: ThemeStyles }
    | undefined;
  const loaded = root?.themes?.hash;
  const revalidator = useRevalidator();
  useEffect(() => {
    applyActiveTheme(active);
  }, [active.name, active.updatedAt]);
  useEffect(() => {
    cssWanted = loaded !== undefined && loaded !== hash;
    if (!cssWanted) return;
    if (revalidator.state === "idle") void revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, loaded]);
}
