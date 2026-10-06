import { Check, CircleDashed, LoaderCircle } from "lucide-react";

import type { ReactNode } from "react";

import { SUBAGENT_VISIBLE_MS, type Subagent } from "~/lib/board";
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
      <LoaderCircle className="size-3 shrink-0 animate-spin text-info" />
    );
  return <Check className="size-3 shrink-0 text-success" />;
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
          <span className="sensitive truncate">{label(s)}</span>
          {s.type && s.description && (
            <span className="shrink-0 text-muted-foreground">{s.type}</span>
          )}
          <span className="sensitive ml-auto shrink-0 text-muted-foreground">
            {s.stale ? "stale" : since(s.startedAt, now)}
          </span>
        </div>
      ))}
      {finished > 0 && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Check className="size-3 shrink-0 text-success" />
          {finished} subagent{finished === 1 ? "" : "s"} finished in the last{" "}
          {SUBAGENT_VISIBLE_MS / 60000}m
        </div>
      )}
    </div>
  );
}

// Something finished, in the side rail: one line, which opens to what it
// handed back.
export function Finished({
  icon,
  label,
  note,
  children,
}: {
  icon: ReactNode;
  label: ReactNode;
  note: ReactNode;
  children?: ReactNode;
}) {
  const line = (
    <>
      {icon}
      <span className="sensitive min-w-0 truncate">{label}</span>
      <span className="sensitive ml-auto shrink-0 text-muted-foreground">
        {note}
      </span>
    </>
  );
  if (!children) {
    return <div className="flex items-center gap-1.5">{line}</div>;
  }
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        {line}
      </summary>
      <div className="sensitive flex flex-col gap-1 pt-1 pl-4.5">{children}</div>
    </details>
  );
}

// In the modal: every subagent, running ones in full with what they're
// doing, finished ones a line each.
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
      {subagents.map((s) =>
        s.running ? (
          <li key={s.agentId} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <StatusIcon agent={s} />
              <span className="sensitive font-medium">{label(s)}</span>
            </div>
            <div className="sensitive pl-4.5 text-muted-foreground">
              {[s.type, s.stale ? "stale" : `running ${since(s.startedAt, now)}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {s.lastMessage && (
              <p className="sensitive pl-4.5">{s.lastMessage}</p>
            )}
          </li>
        ) : (
          <li key={s.agentId}>
            <Finished
              icon={<StatusIcon agent={s} />}
              label={label(s)}
              note={`${since(s.stoppedAt, now)} ago`}
            >
              {s.type && (
                <span className="text-muted-foreground">{s.type}</span>
              )}
              {s.lastMessage && <p>{s.lastMessage}</p>}
            </Finished>
          </li>
        ),
      )}
    </ul>
  );
}
