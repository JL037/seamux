import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import type { ActionResult } from "~/routes/session-action";

type Intent = "send" | "interrupt" | "resume" | "fork" | "close";

// Posts one of the board's write verbs for a session. `onSuccess` runs once
// per successful submission, e.g. to clear a sent draft.
export function useSessionAction(sessionId: string, onSuccess?: () => void) {
  const fetcher = useFetcher<ActionResult>();
  const handled = useRef<ActionResult | undefined>(undefined);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) onSuccess?.();
  }, [fetcher.state, fetcher.data, onSuccess]);

  return {
    submit: (intent: Intent, fields: Record<string, string> = {}) =>
      fetcher.submit(
        { intent, ...fields },
        { method: "post", action: `/sessions/${sessionId}/action` },
      ),
    pending: fetcher.state !== "idle",
    error: fetcher.state === "idle" ? (fetcher.data?.error ?? null) : null,
  };
}
