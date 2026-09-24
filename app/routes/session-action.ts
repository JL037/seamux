import { data } from "react-router";

import type { Route } from "./+types/session-action";
import { closedSession, loadBoard, sessionInfo } from "~/lib/board.server";
import {
  closeChat,
  fork,
  interrupt,
  resume,
  sendMessage,
} from "~/lib/drive.server";
import { assertFromBoard, SESSION_ID } from "~/lib/guard.server";

const INTENTS = new Set(["send", "interrupt", "resume", "fork", "close"]);
const MAX_MESSAGE = 100_000;

export interface ActionResult {
  ok: boolean;
  error: string | null;
}

async function perform(sessionId: string, intent: string, form: FormData) {
  if (intent === "send") {
    const text = String(form.get("text") ?? "").trim();
    if (!text) throw new Error("Nothing to send");
    if (text.length > MAX_MESSAGE) throw new Error("Message too long");
    await sendMessage(sessionId, text);
  } else if (intent === "close") {
    // Only an idle chat: closing a working one would cut its turn off.
    const card = (await loadBoard()).cards.find(
      (c) => c.sessionId === sessionId,
    );
    if (card?.column !== "idle") {
      throw new Error("Only idle chats can be closed");
    }
    await closeChat(sessionId);
  } else if (intent === "interrupt") {
    await interrupt(sessionId);
  } else if (intent === "resume") {
    const closed = await closedSession(sessionId);
    if (!closed)
      throw new Error("This chat is still live, or has no transcript");
    await resume(sessionId, closed.cwd, closed.name);
  } else if (intent === "fork") {
    const info = await sessionInfo(sessionId);
    if (!info) throw new Error("No transcript to fork from");
    await fork(sessionId, info.cwd, String(form.get("text") ?? ""));
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
