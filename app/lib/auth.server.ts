import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareFunction } from "react-router";

import { basicAuthHeader, readCredentials } from "~/lib/credentials";

// The board runs from its checkout, so that is where its .env is.
export function isSecured(): boolean {
  return readCredentials(process.cwd()) !== null;
}

// HTTP Basic in front of every route: documents, data requests and actions.
// Without credentials configured it lets everything through, and the board
// turns red and names itself "seamux (unsecured)" instead.
export const requireBasicAuth: MiddlewareFunction<Response> = (
  { request },
  next,
) => {
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
