import type { Route } from "./+types/dispatch";
import { isEngine } from "~/lib/config";
import { dispatch, installedEngines, nameFrom } from "~/lib/drive.server";
import { assertFromBoard } from "~/lib/guard.server";

export interface DispatchResult {
  ok: boolean;
  error: string | null;
  sessionId: string | null;
}

export async function action({
  request,
}: Route.ActionArgs): Promise<DispatchResult> {
  assertFromBoard(request);
  const form = await request.formData();
  const prompt = String(form.get("prompt") ?? "");
  const engine = String(form.get("engine") ?? "claude");
  try {
    if (!isEngine(engine)) throw new Error("Unknown engine");
    if (!installedEngines()[engine])
      throw new Error(`${engine} is not installed on this Mac`);
    const sessionId = await dispatch({
      cwd: String(form.get("cwd") ?? ""),
      engine,
      prompt,
      // A new worktree is named after the work.
      worktree: form.get("worktree") === "on" ? nameFrom(prompt) : null,
    });
    return { ok: true, error: null, sessionId };
  } catch (err) {
    return { ok: false, error: (err as Error).message, sessionId: null };
  }
}
