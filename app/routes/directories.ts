import { knownDirectories } from "~/lib/board.server";

export async function loader() {
  return { directories: await knownDirectories() };
}
