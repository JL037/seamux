import { Check, CircleDashed, LoaderCircle } from "lucide-react";

import type { Subagent } from "~/lib/board";
import { cn } from "~/lib/utils";

function since(ms: number | null, now: number): string {
  if (ms == null) return "";
  const m = Math.max(0, Math.round((now - ms) / 60000));
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function StatusIcon({ agent }: { agent: Subagent }) {
  if (agent.stale) return <CircleDashed className="size-3 shrink-0" />;
  if (agent.running)
    return (
      <LoaderCircle className="size-3 shrink-0 animate-spin text-sky-500" />
    );
  return <Check className="size-3 shrink-0 text-emerald-500" />;
}

function label(agent: Subagent): string {
  return agent.description ?? agent.type ?? agent.agentId;
}

// On a card: running subagents one per line, finished ones as a count.
export function SubagentSummary({
  subagents,
  now,
}: {
  subagents: Subagent[];
  now: number;
}) {
  const running = subagents.filter((s) => s.running);
  const finished = subagents.length - running.length;
  if (subagents.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {running.map((s) => (
        <div
          key={s.agentId}
          className={cn(
            "flex items-center gap-1.5",
            s.stale && "text-muted-foreground",
          )}
        >
          <StatusIcon agent={s} />
          <span className="truncate">{label(s)}</span>
          {s.type && s.description && (
            <span className="shrink-0 text-muted-foreground">{s.type}</span>
          )}
          <span className="ml-auto shrink-0 text-muted-foreground">
            {s.stale ? "stale" : since(s.startedAt, now)}
          </span>
        </div>
      ))}
      {finished > 0 && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Check className="size-3 shrink-0 text-emerald-500" />
          {finished} subagent{finished === 1 ? "" : "s"} finished in the last
          30m
        </div>
      )}
    </div>
  );
}

// In the modal: every subagent with what it handed back.
export function SubagentDetail({
  subagents,
  now,
}: {
  subagents: Subagent[];
  now: number;
}) {
  if (subagents.length === 0) {
    return <p className="text-xs text-muted-foreground">No subagents.</p>;
  }
  return (
    <ul className="flex flex-col gap-3 text-xs">
      {subagents.map((s) => (
        <li key={s.agentId} className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <StatusIcon agent={s} />
            <span className="font-medium">{label(s)}</span>
          </div>
          <div className="pl-4.5 text-muted-foreground">
            {[
              s.type,
              s.stale
                ? "stale"
                : s.running
                  ? `running ${since(s.startedAt, now)}`
                  : `finished ${since(s.stoppedAt, now)} ago`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {s.lastMessage && <p className="pl-4.5">{s.lastMessage}</p>}
        </li>
      ))}
    </ul>
  );
}
