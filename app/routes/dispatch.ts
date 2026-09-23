import type { Route } from "./+types/dispatch";
import { dispatch, nameFrom } from "~/lib/drive.server";
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
  try {
    const sessionId = await dispatch({
      cwd: String(form.get("cwd") ?? ""),
      prompt,
      // A new worktree is named after the work.
      worktree: form.get("worktree") === "on" ? nameFrom(prompt) : null,
    });
    return { ok: true, error: null, sessionId };
  } catch (err) {
    return { ok: false, error: (err as Error).message, sessionId: null };
  }
}
