import { data } from "react-router";

import type { Route } from "./+types/theme-swap";
import { isLocalRequest } from "~/lib/guard.server";
import { SEAMUX_HOME } from "~/lib/paths.server";
import { isLanHost } from "~/lib/remote.server";
import { DEFAULT_THEME } from "~/lib/theme";
import { readThemes, readThemeSwap, setActiveTheme } from "~/lib/theme.server";

// Remote theme swapping, from the Debug tab: picks the board's theme from
// curl or a Shortcut. The one action that skips assertFromBoard, since a
// script sends no Origin. remoteGate and the HTTP Basic check have already
// run, and it can only choose among saved themes, never make or change one.

// Never a GET, which any page the user visits could fire with an <img>.
export function loader() {
  throw data(null, { status: 405, headers: { Allow: "POST" } });
}

async function nameOf(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
    } | null;
    return body?.name;
  }
  return (await request.formData().catch(() => null))?.get("name");
}

export async function action({ request }: Route.ActionArgs) {
  // On this Mac, or this Mac's .local name; never through the tunnel.
  const host = request.headers.get("host");
  if (!isLocalRequest(request) && !isLanHost(SEAMUX_HOME, host)) {
    throw data(null, { status: 403 });
  }
  // A browser sends an Origin with every cross-site POST, and React Router
  // doesn't check it on a route without a page (knowledge/
  // vite-and-react-router.md), so another site's form would get here. A
  // script sends none; the board itself sends its own.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== `http://${host}`) {
    throw data(null, { status: 403 });
  }
  if (!readThemeSwap().on) throw data(null, { status: 403 });
  const name = await nameOf(request);
  if (
    typeof name !== "string" ||
    (name !== DEFAULT_THEME && !Object.hasOwn(readThemes(), name))
  ) {
    throw data(null, { status: 404 });
  }
  setActiveTheme(name);
  return new Response(null, { status: 204 });
}
