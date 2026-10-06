import { useState } from "react";
import { Check, CircleDashed, Ghost, X } from "lucide-react";

import type { DispatchSet, WorkerState } from "~/lib/board";
import { cn } from "~/lib/utils";

export function WorkerStatus({ status }: { status: WorkerState }) {
  if (status === "ok") return <Check className="size-3 text-success" />;
  if (status === "failed") return <X className="size-3 text-destructive" />;
  // Its session ended without reporting.
  if (status === "gone")
    return <Ghost className="size-3 text-warning" aria-label="gone" />;
  return <CircleDashed className="size-3 text-muted-foreground" />;
}

const reportedOf = (workers: DispatchSet["workers"]) =>
  workers.filter((w) => w.status === "ok" || w.status === "failed").length;

// Fan-outs from the protocol: each set, and which workers have reported.
// Below md they fold into one line that opens them.
export function DispatchStrip({ sets }: { sets: DispatchSet[] }) {
  const [open, setOpen] = useState(false);
  if (sets.length === 0) return null;
  const workers = sets.flatMap((s) => s.workers);
  const reported = reportedOf(workers);
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm md:hidden"
      >
        <span className="font-medium">
          {sets.length === 1 ? "1 fan-out" : `${sets.length} fan-outs`}
        </span>
        <span className="text-xs text-muted-foreground">
          {reported}/{workers.length} reported
        </span>
        <span className="ml-auto text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {sets.map((set) => {
        const reported = reportedOf(set.workers);
        const gone = set.workers.filter((w) => w.status === "gone").length;
        const settled = set.settledAt !== null;
        return (
          <div
            key={set.id}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-3 py-2 text-sm",
              settled && "opacity-70",
              !open && "max-md:hidden",
            )}
          >
            <span className="sensitive font-medium">{set.title}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {set.id}
            </span>
            <span className="text-xs text-muted-foreground">
              {reported === set.workers.length
                ? "all reported"
                : `${reported}/${set.workers.length} reported`}
              {gone > 0 && `, ${gone} gone`}
            </span>
            <span className="flex flex-wrap gap-2">
              {set.workers.map((w) => (
                <span
                  key={w.key}
                  className="inline-flex items-center gap-1 font-mono text-xs"
                >
                  <WorkerStatus status={w.status} />
                  {w.key}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </section>
  );
}
