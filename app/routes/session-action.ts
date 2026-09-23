import { data } from "react-router";

import type { Route } from "./+types/session-action";
import { closedSession } from "~/lib/board.server";
import { interrupt, resume, sendMessage } from "~/lib/drive.server";

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const INTENTS = new Set(["send", "interrupt", "resume"]);
const MAX_MESSAGE = 100_000;

export interface ActionResult {
  ok: boolean;
  error: string | null;
}

// These endpoints type into live sessions. A browser lets any website POST
// a form to 127.0.0.1, so only accept requests the board itself made:
// the Host must be local (no DNS rebinding) and the Origin must match it.
function assertFromBoard(request: Request) {
  const host = request.headers.get("host") ?? "";
  const origin = request.headers.get("origin");
  const hostname = host.replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(hostname) || origin !== `http://${host}`) {
    throw data("Forbidden", { status: 403 });
  }
}

async function perform(sessionId: string, intent: string, form: FormData) {
  if (intent === "send") {
    const text = String(form.get("text") ?? "").trim();
    if (!text) throw new Error("Nothing to send");
    if (text.length > MAX_MESSAGE) throw new Error("Message too long");
    await sendMessage(sessionId, text);
  } else if (intent === "interrupt") {
    await interrupt(sessionId);
  } else if (intent === "resume") {
    const closed = await closedSession(sessionId);
    if (!closed)
      throw new Error("This chat is still live, or has no transcript");
    await resume(sessionId, closed.cwd, closed.name);
  }
}

export async function action({
  request,
  params,
}: Route.ActionArgs): Promise<ActionResult> {
  assertFromBoard(request);
  if (!SESSION_ID.test(params.sessionId)) {
    throw data("Bad session id", { status: 400 });
  }
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (!INTENTS.has(intent)) throw data("Unknown intent", { status: 400 });

  try {
    await perform(params.sessionId, intent, form);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
