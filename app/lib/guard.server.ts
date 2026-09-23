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

export const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
