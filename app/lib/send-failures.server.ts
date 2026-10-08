// The last message the board failed to get into each chat, sent straight
// from a card or from seamux's queue, and why, for its card to show until a
// message goes, the box is emptied for the board to edit, or it is
// dismissed. Nothing else records a send that failed. It is kept in memory
// only: after a restart, a message still in the chat's prompt box shows
// anyway, read off the screen.

import type { SendFailure } from "./board.ts";

// Kept on globalThis so a hot reload keeps what failed.
const failures = ((globalThis as any).__seamuxSendFailures ??= new Map()) as Map<
  string,
  SendFailure
>;

export function recordFailure(sessionId: string, text: string, err: unknown) {
  failures.set(sessionId, {
    text,
    error: err instanceof Error ? err.message : String(err),
    at: Date.now(),
  });
}

export function clearFailure(sessionId: string) {
  failures.delete(sessionId);
}

export function failureFor(sessionId: string): SendFailure | null {
  return failures.get(sessionId) ?? null;
}
