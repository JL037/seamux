import type { ContextUsage } from "~/lib/board";
import { cn } from "~/lib/utils";

function tokens(n: number): string {
  return n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)}M`
    : `${Math.round(n / 1000)}k`;
}

// How full the chat's context window is, hung under its input as the input's
// bottom edge. The gradient spans the whole window, so the colour at the end
// of the fill says how close the chat is to auto-compacting.
export function ContextBar({
  context,
  className,
}: {
  context: ContextUsage | null;
  className?: string;
}) {
  const pct = context
    ? Math.min(100, (context.used / context.window) * 100)
    : 0;
  const label = context
    ? `Context: ${tokens(context.used)} of ${tokens(context.window)} (${Math.round(pct)}%)`
    : "Context: unknown until the next response";
  return (
    <div
      role="meter"
      aria-label="Context used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={label}
      title={label}
      className={cn(
        "relative h-1.5 overflow-hidden rounded-b-lg border border-t-0 bg-clip-padding bg-gradient-to-r from-success via-warning to-attention",
        className,
      )}
    >
      <div
        className="absolute inset-y-0 right-0 bg-muted transition-[width] duration-500"
        style={{ width: `${100 - pct}%` }}
      />
    </div>
  );
}
