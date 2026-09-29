import type { MiddlewareFunction } from "react-router";

import {
  basicAuthHeader,
  readCredentials,
  sameSecret,
} from "~/lib/credentials";
import {
  ACCESS_HEADER,
  checkTunnelRequest,
  forbiddenPage,
  isLanHost,
  isTunnelHost,
} from "~/lib/remote.server";
import { SEAMUX_HOME } from "~/lib/paths.server";

// A request through the tunnel has passed Cloudflare Access, so it counts.
export function isSecured(request: Request): boolean {
  return (
    readCredentials(SEAMUX_HOME) !== null ||
    isTunnelHost(SEAMUX_HOME, request.headers.get("host"))
  );
}

// In front of every route: documents, data requests and actions.
//
// Through the tunnel, Cloudflare Access is the login: the request must carry
// a valid Access token, and HTTP Basic isn't asked for. Otherwise HTTP Basic,
// when credentials are configured. Without them it lets everything through,
// and the board turns red and names itself "seamux (unsecured)" instead,
// except at the mDNS name, which never answers without them. (The dev
// server's own middleware, in vite.config.ts, has already checked a request
// from the network, since only it can see the socket.)
export const requireAuth: MiddlewareFunction<Response> = async (
  { request },
  next,
) => {
  const tunnel = await checkTunnelRequest(
    SEAMUX_HOME,
    request.headers.get("host"),
    request.headers.get(ACCESS_HEADER),
  );
  if (tunnel.verdict === "allowed") return next();
  if (tunnel.verdict === "denied") {
    return new Response(forbiddenPage(tunnel.reason), {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const credentials = readCredentials(SEAMUX_HOME);
  if (!credentials) {
    if (!isLanHost(SEAMUX_HOME, request.headers.get("host"))) return next();
    return new Response(
      forbiddenPage(
        "SEAMUX_USER and SEAMUX_PASS are unset, and the board doesn't answer the network without them",
        false,
      ),
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const given = request.headers.get("authorization") ?? "";
  if (sameSecret(given, basicAuthHeader(credentials))) return next();
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="seamux", charset="UTF-8"' },
  });
};
