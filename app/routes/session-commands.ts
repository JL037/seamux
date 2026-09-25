import { data } from "react-router";

import type { Route } from "./+types/session-commands";
import { sessionInfo } from "~/lib/board.server";
import { slashCommands } from "~/lib/commands.server";
import { SESSION_ID } from "~/lib/guard.server";

// The slash commands a chat's inputs suggest. Only Claude Code lists them.
export async function loader({ params }: Route.LoaderArgs) {
  if (!SESSION_ID.test(params.sessionId)) {
    throw data("Bad session id", { status: 400 });
  }
  const info = await sessionInfo(params.sessionId);
  if (!info) throw data("No transcript", { status: 404 });
  if (info.engine !== "claude") return { commands: [] };
  try {
    return { commands: await slashCommands(info.cwd) };
  } catch (err) {
    console.error("seamux commands:", (err as Error).message);
    return { commands: [] };
  }
}
