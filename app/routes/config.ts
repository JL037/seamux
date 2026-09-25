import { data } from "react-router";

import type { Route } from "./+types/config";
import {
  addDirectory,
  isMacroName,
  removeDirectory,
  setDefaultEngine,
  setMacro,
  setWorktreeByDefault,
} from "~/lib/config.server";
import { checkDirectory } from "~/lib/drive.server";
import { assertFromBoard, isLocalRequest } from "~/lib/guard.server";
import { readCredentials } from "~/lib/credentials";
import {
  readRemoteSettings,
  setRemoteSwitch,
  type RemoteSwitch,
} from "~/lib/remote.server";

const INTENTS = new Set([
  "add-directory",
  "remove-directory",
  "worktree-default",
  "default-engine",
  "save-macro",
  "reset-macro",
  "remote",
  "tunnel",
  "mdns",
]);

export interface ConfigResult {
  ok: boolean;
  error: string | null;
}

async function perform(intent: string, form: FormData, request: Request) {
  const field = (name: string) => String(form.get(name) ?? "");
  if (intent === "add-directory") {
    addDirectory(await checkDirectory(field("path").trim()));
  } else if (intent === "remove-directory") {
    removeDirectory(field("path"));
  } else if (intent === "worktree-default") {
    setWorktreeByDefault(field("on") === "true");
  } else if (intent === "default-engine") {
    setDefaultEngine(field("engine"));
  } else if (intent === "save-macro" || intent === "reset-macro") {
    const name = field("name");
    if (!isMacroName(name)) throw new Error("Unknown macro");
    setMacro(name, intent === "save-macro" ? field("text") : null);
  } else if (intent === "remote" || intent === "tunnel" || intent === "mdns") {
    setRemote(intent, field("on") === "true", request);
  }
}

// Remote access turns on only from this Mac, so a lost phone can't reopen
// it once it's off. It turns off from anywhere.
function setRemote(which: RemoteSwitch, on: boolean, request: Request) {
  if (on) {
    if (!isLocalRequest(request)) {
      throw new Error("Remote access can only be turned on from this Mac");
    }
    if (which === "tunnel") {
      const { missing } = readRemoteSettings(process.cwd());
      if (missing.length > 0) {
        throw new Error(`Set ${missing.join(", ")} first`);
      }
    }
    if (which === "mdns" && !readCredentials(process.cwd())) {
      throw new Error("Set SEAMUX_USER and SEAMUX_PASS first");
    }
  }
  setRemoteSwitch(process.cwd(), which, on);
}

export async function action({
  request,
}: Route.ActionArgs): Promise<ConfigResult> {
  assertFromBoard(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (!INTENTS.has(intent)) throw data("Unknown intent", { status: 400 });
  try {
    await perform(intent, form, request);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
