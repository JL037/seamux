import { Check, CircleDashed, X } from "lucide-react";

import type { DispatchSet } from "~/lib/board";
import { cn } from "~/lib/utils";

export function WorkerStatus({ status }: { status: "ok" | "failed" | null }) {
  if (status === "ok") return <Check className="size-3 text-emerald-500" />;
  if (status === "failed") return <X className="size-3 text-destructive" />;
  return <CircleDashed className="size-3 text-muted-foreground" />;
}

// Fan-outs from the protocol: each set, and which workers have reported.
export function DispatchStrip({ sets }: { sets: DispatchSet[] }) {
  if (sets.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      {sets.map((set) => {
        const reported = set.workers.filter((w) => w.status).length;
        const complete = reported === set.workers.length;
        return (
          <div
            key={set.id}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-3 py-2 text-sm",
              complete && "opacity-70",
            )}
          >
            <span className="font-medium">{set.title}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {set.id}
            </span>
            <span className="text-xs text-muted-foreground">
              {complete
                ? "all reported"
                : `${reported}/${set.workers.length} reported`}
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
