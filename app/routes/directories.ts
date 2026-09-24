import type { Route } from "./+types/directories";
import { knownDirectories } from "~/lib/board.server";
import { configOrDefaults } from "~/lib/config.server";

// The dispatch picker's list: the configured directories when there are
// any, otherwise every directory seamux can find. `?discovered` asks for
// the latter regardless, for the config dialog to suggest from.
export async function loader({ request }: Route.LoaderArgs) {
  const configured = configOrDefaults().directories;
  if (
    configured.length > 0 &&
    !new URL(request.url).searchParams.has("discovered")
  ) {
    return { directories: configured };
  }
  return { directories: await knownDirectories() };
}
