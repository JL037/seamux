import { Check, CircleDashed, Ghost, X } from "lucide-react";

import { Finished } from "~/components/subagent-list";
import type { DispatchSet, WorkerState } from "~/lib/board";

function WorkerStatus({ status }: { status: WorkerState }) {
  if (status === "ok") return <Check className="size-3 shrink-0 text-success" />;
  if (status === "failed")
    return <X className="size-3 shrink-0 text-destructive" />;
  // Its session ended without reporting.
  if (status === "gone")
    return <Ghost className="size-3 shrink-0 text-warning" />;
  return <CircleDashed className="size-3 shrink-0 text-muted-foreground" />;
}

const STATE: Record<NonNullable<WorkerState>, string> = {
  ok: "reported",
  failed: "failed",
  gone: "gone",
};

export function workerCount(fanouts: DispatchSet[]): number {
  return fanouts.reduce((n, d) => n + d.workers.length, 0);
}

// In the modal: every worker of the chat's fan-outs. One still out gets its
// own lines; one that has reported or ended, a line that opens to its
// handback.
export function WorkerDetail({ fanouts }: { fanouts: DispatchSet[] }) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      {fanouts.map((d) => (
        <section key={d.id} className="flex flex-col gap-3">
          {fanouts.length > 1 && (
            <p className="sensitive font-medium text-muted-foreground">
              {d.title}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {d.workers.map((w) => (
              <li key={w.key}>
                {w.status ? (
                  <Finished
                    icon={<WorkerStatus status={w.status} />}
                    label={<span className="font-mono">{w.key}</span>}
                    note={STATE[w.status]}
                  >
                    {w.summary && <p>{w.summary}</p>}
                  </Finished>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <WorkerStatus status={null} />
                      <span className="sensitive font-mono font-medium">
                        {w.key}
                      </span>
                    </div>
                    <div className="pl-4.5 text-muted-foreground">
                      not reported yet
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
