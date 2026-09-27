import { data } from "react-router";

import type { Route } from "./+types/session-messages";
import { loadMessages } from "~/lib/board.server";
import { SESSION_ID } from "~/lib/guard.server";

export async function loader({ params }: Route.LoaderArgs) {
  if (!SESSION_ID.test(params.sessionId)) {
    throw data("Bad session id", { status: 400 });
  }
  // A chat writes no transcript until its first prompt: no messages yet,
  // not an error, which would take the whole board down with it.
  const messages = (await loadMessages(params.sessionId)) ?? [];
  return { messages };
}
