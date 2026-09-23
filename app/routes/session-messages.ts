import { data } from "react-router";

import type { Route } from "./+types/session-messages";
import { loadMessages } from "~/lib/board.server";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function loader({ params }: Route.LoaderArgs) {
  if (!SESSION_ID.test(params.sessionId)) {
    throw data("Bad session id", { status: 400 });
  }
  const messages = await loadMessages(params.sessionId);
  if (!messages) throw data("No transcript", { status: 404 });
  return { messages };
}
