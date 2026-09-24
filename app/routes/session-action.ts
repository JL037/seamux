import { data } from "react-router";

import type { Route } from "./+types/session-action";
import { closable, type Answer, type Question } from "~/lib/board";
import { closedSession, loadBoard, sessionInfo } from "~/lib/board.server";
import {
  answerQuestion,
  closeChat,
  fork,
  interrupt,
  resume,
  sendMessage,
} from "~/lib/drive.server";
import { assertFromBoard, SESSION_ID } from "~/lib/guard.server";
import { setPinned } from "~/lib/store.server";

const INTENTS = new Set([
  "send",
  "interrupt",
  "resume",
  "fork",
  "close",
  "pin",
  "unpin",
  "answer",
]);
const MAX_MESSAGE = 100_000;

export interface ActionResult {
  ok: boolean;
  error: string | null;
}

// Answers from the board, checked against the questions actually open.
function parseAnswers(raw: string, questions: Question[]): Answer[] {
  let answers: unknown;
  try {
    answers = JSON.parse(raw);
  } catch {
    throw new Error("Bad answers");
  }
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new Error("Answer every question");
  }
  return questions.map((q, i) => {
    const a = answers[i];
    if (typeof a?.text === "string" && !q.multiSelect) {
      const text = a.text.trim();
      if (!text) throw new Error("Answer every question");
      if (text.length > MAX_MESSAGE) throw new Error("Answer too long");
      return { text };
    }
    const picks = a?.picks;
    const valid =
      Array.isArray(picks) &&
      picks.length > 0 &&
      (q.multiSelect || picks.length === 1) &&
      new Set(picks).size === picks.length &&
      picks.every((p) => Number.isInteger(p) && p >= 0 && p < q.options.length);
    if (!valid) throw new Error("Answer every question");
    return { picks };
  });
}

async function perform(sessionId: string, intent: string, form: FormData) {
  if (intent === "send") {
    const text = String(form.get("text") ?? "").trim();
    if (!text) throw new Error("Nothing to send");
    if (text.length > MAX_MESSAGE) throw new Error("Message too long");
    await sendMessage(sessionId, text);
  } else if (intent === "close") {
    // Only a chat at rest: closing a working one would cut its turn off.
    const card = (await loadBoard()).cards.find(
      (c) => c.sessionId === sessionId,
    );
    if (!card || !closable(card)) {
      throw new Error("Only idle chats can be closed");
    }
    await closeChat(sessionId);
  } else if (intent === "answer") {
    // Only the question still open: keys sent after it closed would land
    // in the prompt box instead.
    const card = (await loadBoard()).cards.find(
      (c) => c.sessionId === sessionId,
    );
    const ask = card?.waiting?.ask;
    if (!ask || ask.toolUseId !== form.get("toolUseId")) {
      throw new Error("That question is no longer open");
    }
    const answers = parseAnswers(
      String(form.get("answers") ?? ""),
      ask.questions,
    );
    await answerQuestion(sessionId, ask.questions, answers);
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
  } else if (intent === "pin" || intent === "unpin") {
    setPinned(sessionId, intent === "pin");
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
