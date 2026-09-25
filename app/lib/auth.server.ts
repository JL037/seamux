import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareFunction } from "react-router";

import { basicAuthHeader, readCredentials } from "~/lib/credentials";
import {
  ACCESS_HEADER,
  checkTunnelRequest,
  forbiddenPage,
  isTunnelHost,
} from "~/lib/remote.server";

// The board runs from its checkout, so that is where its .env is.
// A request through the tunnel has passed Cloudflare Access, so it counts.
export function isSecured(request: Request): boolean {
  return (
    readCredentials(process.cwd()) !== null ||
    isTunnelHost(process.cwd(), request.headers.get("host"))
  );
}

// In front of every route: documents, data requests and actions.
//
// Through the tunnel, Cloudflare Access is the login: the request must carry
// a valid Access token, and HTTP Basic isn't asked for. Otherwise HTTP Basic,
// when credentials are configured. Without them it lets everything through,
// and the board turns red and names itself "seamux (unsecured)" instead.
export const requireAuth: MiddlewareFunction<Response> = async (
  { request },
  next,
) => {
  const tunnel = await checkTunnelRequest(
    process.cwd(),
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
  const credentials = readCredentials(process.cwd());
  if (!credentials) return next();
  const given = request.headers.get("authorization") ?? "";
  if (sameSecret(given, basicAuthHeader(credentials))) return next();
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="seamux", charset="UTF-8"' },
  });
};

// Compare digests, so neither the length nor the content of the expected
// header leaks through timing.
function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
