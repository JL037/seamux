import { data } from "react-router";

import type { Route } from "./+types/theme-swap";
import { isLocalRequest } from "~/lib/guard.server";
import { SEAMUX_HOME } from "~/lib/paths.server";
import { isLanHost } from "~/lib/remote.server";
import { DEFAULT_THEME } from "~/lib/theme";
import {
  isSwapToken,
  readThemes,
  readThemeSwap,
  setActiveTheme,
} from "~/lib/theme.server";

// Remote theme swapping, from the Debug tab: picks the board's theme from
// curl or a Shortcut, with the token the Debug tab shows. The one action
// that skips assertFromBoard, since a script sends no Origin: the token
// stands in for it. It can only choose among saved themes, never make or
// change one. remoteGate and the HTTP Basic check have already run.

// Never a GET, which any page the user visits could fire with an <img>.
export function loader() {
  throw data(null, { status: 405, headers: { Allow: "POST" } });
}

async function fields(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    return { name: body?.name, token: body?.token };
  }
  const form = await request.formData().catch(() => null);
  return { name: form?.get("name"), token: form?.get("token") };
}

export async function action({ request }: Route.ActionArgs) {
  // On this Mac, or this Mac's .local name; never through the tunnel.
  const host = request.headers.get("host");
  if (!isLocalRequest(request) && !isLanHost(SEAMUX_HOME, host)) {
    throw data(null, { status: 403 });
  }
  if (!readThemeSwap().on) throw data(null, { status: 403 });
  const { name, token } = await fields(request);
  if (typeof token !== "string" || !isSwapToken(token)) {
    throw data(null, { status: 403 });
  }
  if (
    typeof name !== "string" ||
    (name !== DEFAULT_THEME && !Object.hasOwn(readThemes(), name))
  ) {
    throw data(null, { status: 404 });
  }
  setActiveTheme(name);
  return new Response(null, { status: 204 });
}
