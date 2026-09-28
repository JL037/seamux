import type { Route } from "./+types/directories";
import { knownDirectories } from "~/lib/board.server";
import { configOrDefaults } from "~/lib/config.server";
import { completeDirectory } from "~/lib/files.server";
import { assertLocalRead } from "~/lib/guard.server";

// The dispatch picker's list: the configured directories when there are
// any, otherwise every directory seamux can find. `?discovered` asks for
// the latter regardless, for the config dialog to suggest from.
// `?complete=<path>` asks instead for the directories on disk that a partly
// typed path could go on to name, for the picker's Tab.
export async function loader({ request }: Route.LoaderArgs) {
  const complete = new URL(request.url).searchParams.get("complete");
  if (complete !== null) {
    assertLocalRead(request);
    return { directories: await completeDirectory(complete) };
  }
  const configured = configOrDefaults().directories;
  if (
    configured.length > 0 &&
    !new URL(request.url).searchParams.has("discovered")
  ) {
    return { directories: configured };
  }
  return { directories: await knownDirectories() };
}
