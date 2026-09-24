import { data } from "react-router";

import type { Route } from "./+types/file-stat";
import { resolveFile } from "~/lib/files.server";
import { assertLocalRead } from "~/lib/guard.server";

// When a file last changed, for the viewer to poll: cheap enough to ask
// every second, where reloading the file itself is not.
export async function loader({ request }: Route.LoaderArgs) {
  assertLocalRead(request);
  const path = new URL(request.url).searchParams.get("path");
  if (!path) throw data("No path", { status: 400 });
  const found = await resolveFile(path);
  return { mtime: found ? found.stats.mtimeMs : null };
}
