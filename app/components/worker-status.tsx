import { Check, CircleDashed, Ghost, X } from "lucide-react";

import type { WorkerState } from "~/lib/board";

// Where a fan-out worker stands, on its card.
export function WorkerStatus({ status }: { status: WorkerState }) {
  if (status === "ok") return <Check className="size-3 text-success" />;
  if (status === "failed") return <X className="size-3 text-destructive" />;
  // Its session ended without reporting.
  if (status === "gone")
    return <Ghost className="size-3 text-warning" aria-label="gone" />;
  return <CircleDashed className="size-3 text-muted-foreground" />;
}
