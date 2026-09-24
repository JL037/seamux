import { data } from "react-router";

import type { Route } from "./+types/config";
import {
  addDirectory,
  isMacroName,
  removeDirectory,
  setMacro,
  setWorktreeByDefault,
} from "~/lib/config.server";
import { checkDirectory } from "~/lib/drive.server";
import { assertFromBoard } from "~/lib/guard.server";

const INTENTS = new Set([
  "add-directory",
  "remove-directory",
  "worktree-default",
  "save-macro",
  "reset-macro",
]);

export interface ConfigResult {
  ok: boolean;
  error: string | null;
}

async function perform(intent: string, form: FormData) {
  const field = (name: string) => String(form.get(name) ?? "");
  if (intent === "add-directory") {
    addDirectory(await checkDirectory(field("path").trim()));
  } else if (intent === "remove-directory") {
    removeDirectory(field("path"));
  } else if (intent === "worktree-default") {
    setWorktreeByDefault(field("on") === "true");
  } else if (intent === "save-macro" || intent === "reset-macro") {
    const name = field("name");
    if (!isMacroName(name)) throw new Error("Unknown macro");
    setMacro(name, intent === "save-macro" ? field("text") : null);
  }
}

export async function action({
  request,
}: Route.ActionArgs): Promise<ConfigResult> {
  assertFromBoard(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (!INTENTS.has(intent)) throw data("Unknown intent", { status: 400 });
  try {
    await perform(intent, form);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
