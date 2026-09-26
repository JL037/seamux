import { data } from "react-router";

import type { Route } from "./+types/diagnostics";
import { saveDiagnostics } from "~/lib/diagnostics.server";
import { assertFromBoard } from "~/lib/guard.server";

const MAX_BYTES = 2_000_000;

// A snapshot from the Debug tab's diagnostics, kept in data/diagnostics.
export async function action({ request }: Route.ActionArgs) {
  assertFromBoard(request);
  const text = await request.text();
  if (text.length > MAX_BYTES) throw data("Too large", { status: 413 });
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(text);
  } catch {
    throw data("Not JSON", { status: 400 });
  }
  saveDiagnostics({
    receivedAt: new Date().toISOString(),
    host: request.headers.get("host"),
    snapshot,
  });
  return { ok: true };
}
