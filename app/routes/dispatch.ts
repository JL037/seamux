import { randomUUID } from "node:crypto";

import { data } from "react-router";

import type { Route } from "./+types/dispatch";
import { MAX_ATTACHMENTS_BYTES, withoutLabels } from "~/lib/attachments";
import { withAttachments } from "~/lib/attachments.server";
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
  // Room for the most a prompt's attachments may add up to, and its text.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_ATTACHMENTS_BYTES + (1 << 20)) {
    throw data("Too large", { status: 413 });
  }
  const form = await request.formData();
  const typed = String(form.get("prompt") ?? "");
  const engine = String(form.get("engine") ?? "claude");
  try {
    if (!isEngine(engine)) throw new Error("Unknown engine");
    if (!installedEngines()[engine])
      throw new Error(`${engine} is not installed on this Mac`);
    // The session's id isn't known yet (Codex picks its own), so its files
    // go under a directory of their own.
    const prompt = await withAttachments(randomUUID(), typed, form);
    // Named after the words, not the attachments' labels.
    const name = nameFrom(withoutLabels(typed));
    const sessionId = await dispatch({
      cwd: String(form.get("cwd") ?? ""),
      engine,
      prompt,
      name,
      // A new worktree is named after the work.
      worktree: form.get("worktree") === "on" ? name : null,
    });
    return { ok: true, error: null, sessionId };
  } catch (err) {
    return { ok: false, error: (err as Error).message, sessionId: null };
  }
}
