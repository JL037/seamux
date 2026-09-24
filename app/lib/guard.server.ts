import { data } from "react-router";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

// The board's actions spawn sessions and type into them. A browser lets any
// website POST a form to 127.0.0.1, so only accept requests the board itself
// made: the Host must be local (no DNS rebinding) and the Origin must match.
export function assertFromBoard(request: Request) {
  const host = request.headers.get("host") ?? "";
  const origin = request.headers.get("origin");
  const hostname = host.replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(hostname) || origin !== `http://${host}`) {
    throw data("Forbidden", { status: 403 });
  }
}

// Reads of files on disk. Another website can't read the response, but it
// could embed a script or probe which paths exist, so refuse any request a
// page on another site made.
export function assertLocalRead(request: Request) {
  assertLocalHost(request);
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") {
    throw data("Forbidden", { status: 403 });
  }
}

// No DNS rebinding: a site that points its own name at 127.0.0.1 would
// otherwise be same-origin with the board.
export function assertLocalHost(request: Request) {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ""))) {
    throw data("Forbidden", { status: 403 });
  }
}

export const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
