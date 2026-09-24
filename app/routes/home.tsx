import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRevalidator } from "react-router";
import {
  GitBranch,
  Layers,
  Maximize2,
  Play,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";

import type { Route } from "./+types/home";
import { ChatModal } from "~/components/chat-modal";
import { DispatchBar } from "~/components/dispatch-bar";
import { DispatchStrip, WorkerStatus } from "~/components/dispatch-strip";
import { SubagentSummary } from "~/components/subagent-list";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  COLUMN_LABELS,
  COLUMNS,
  type Board,
  type Card as BoardCard,
  type Column,
} from "~/lib/board";
import { loadBoard } from "~/lib/board.server";
import { useSessionAction } from "~/lib/use-session-action";
import { useSessionStorage } from "~/lib/use-session-storage";
import { cn } from "~/lib/utils";

const POLL_MS = 3000;

export function meta({}: Route.MetaArgs) {
  return [{ title: "seemux" }];
}

export async function loader() {
  return loadBoard();
}

// Re-run the loader on an interval while the tab is visible.
function usePoll(ms: number) {
  const revalidator = useRevalidator();
  useEffect(() => {
    const id = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        revalidator.state === "idle"
      ) {
        revalidator.revalidate();
      }
    }, ms);
    return () => clearInterval(id);
  }, [ms, revalidator]);
}

const COLUMN_ACCENT: Record<Column, string> = {
  idle: "bg-muted-foreground/40",
  waiting: "bg-amber-500",
  working: "bg-sky-500",
  done: "bg-emerald-500/60",
};

function ago(ms: number | null, now: number): string {
  if (ms == null) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function shortPath(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, "~");
}

// A colour for the full project path, the same on every poll and every
// reload, so cards from one directory can be spotted at a glance. FNV-1a
// picks the hue; fixed lightness and chroma keep every hue equally legible.
function pathColor(cwd: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < cwd.length; i++) {
    h ^= cwd.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `oklch(0.7 0.15 ${(h >>> 0) % 360})`;
}

function PathSwatch({ cwd }: { cwd: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-[2px]"
      style={{ backgroundColor: pathColor(cwd) }}
    />
  );
}

// Unsent drafts by session, held above the columns so a draft survives its
// card moving between them.
const DraftsContext = createContext<{
  drafts: Record<string, string>;
  setDraft: (sessionId: string, draft: string) => void;
}>({ drafts: {}, setDraft: () => {} });

// The card's next chat line, with a popout into the full-size modal for
// longer messages. Both send through cmux into the session's surface.
function ChatInput({ card }: { card: BoardCard }) {
  const { drafts, setDraft } = useContext(DraftsContext);
  const [open, setOpen] = useState(false);
  const draft = drafts[card.sessionId] ?? "";
  const onDraftChange = (d: string) => setDraft(card.sessionId, d);
  const clear = useCallback(
    () => setDraft(card.sessionId, ""),
    [card.sessionId, setDraft],
  );
  const { submit, pending, error } = useSessionAction(card.sessionId, clear);
  const forker = useSessionAction(card.sessionId, clear);
  const canSend = card.drivable && !pending && draft.trim().length > 0;
  const send = () => canSend && submit("send", { text: draft });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <form
          className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border bg-background p-1"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={card.drivable ? "Reply" : "Not in a cmux surface"}
            disabled={!card.drivable}
            className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon-xs" disabled={!canSend} title="Send">
            <SendHorizontal />
          </Button>
        </form>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Open full view"
          onClick={() => setOpen(true)}
        >
          <Maximize2 />
        </Button>
      </div>
      {error && <ActionError error={error} />}
      <ChatModal
        card={card}
        open={open}
        onOpenChange={setOpen}
        draft={draft}
        onDraftChange={onDraftChange}
        onSend={send}
        canSend={canSend}
        pending={pending}
        error={error ?? forker.error}
        onFork={() => draft.trim() && forker.submit("fork", { text: draft })}
        forking={forker.pending}
      />
    </div>
  );
}

function ActionError({ error }: { error: string }) {
  return <p className="text-destructive">{error}</p>;
}

// Stop on a WORKING card (Esc into the session), resume on a DONE one.
function CardControl({ card }: { card: BoardCard }) {
  const { submit, pending, error } = useSessionAction(card.sessionId);
  if (card.column === "working") {
    return (
      <Button
        size="icon-xs"
        variant="outline"
        disabled={!card.drivable || pending}
        title={error ?? "Stop this turn (Esc)"}
        onClick={() => submit("interrupt")}
      >
        <Square />
      </Button>
    );
  }
  if (card.column === "idle") {
    return (
      <Button
        size="icon-xs"
        variant="outline"
        disabled={!card.drivable || pending}
        title={error ?? "Close this chat (it moves to Done and can be resumed)"}
        onClick={() => {
          if (
            window.confirm(`Close “${card.name}”? It can be resumed from Done.`)
          ) {
            submit("close");
          }
        }}
      >
        <X />
      </Button>
    );
  }
  if (card.column === "done") {
    return (
      <Button
        size="icon-xs"
        variant="outline"
        disabled={pending}
        title={error ?? "Resume in a new cmux workspace"}
        onClick={() => submit("resume")}
      >
        <Play />
      </Button>
    );
  }
  return null;
}

function SessionCard({ card, now }: { card: BoardCard; now: number }) {
  return (
    <Card size="sm" className={cn(card.column === "done" && "opacity-70")}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="truncate">{card.name}</span>
          <CardControl card={card} />
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <PathSwatch cwd={card.cwd} />
            <span className="truncate font-mono">{shortPath(card.cwd)}</span>
          </span>
          {card.branch && (
            <span className="inline-flex items-center gap-1 font-mono">
              <GitBranch className="size-3" />
              {card.branch}
            </span>
          )}
          <span>{ago(card.lastActivityAt, now)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        {card.worker && (
          <p className="flex items-center gap-1.5 font-mono text-muted-foreground">
            <WorkerStatus status={card.worker.reported} />
            worker {card.worker.key} · {card.worker.dispatchId}
          </p>
        )}
        {card.intent && (
          <p className="line-clamp-2 rounded-md bg-muted px-2 py-1">
            <span className="font-medium">
              {card.forkedFrom ? "Tangent: " : "Goal: "}
            </span>
            {card.intent}
          </p>
        )}
        {card.lastPrompt && card.lastPrompt !== card.intent && (
          <p className="line-clamp-2 text-muted-foreground">
            <span className="font-medium text-foreground">You: </span>
            {card.lastPrompt}
          </p>
        )}
        {card.lastReply && <p className="line-clamp-4">{card.lastReply}</p>}
        <SubagentSummary subagents={card.subagents} now={now} />
        {card.background.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.background.map((b) => (
              <Badge
                key={b.id}
                variant={
                  b.state === "blocked" || b.state === "failed"
                    ? "destructive"
                    : "secondary"
                }
                title={b.needs ?? undefined}
              >
                <Layers />
                {b.name} · {b.state}
              </Badge>
            ))}
          </div>
        )}
        {card.workspaceRef && (
          <span className="font-mono text-muted-foreground">
            {card.workspaceRef}
          </span>
        )}
        <ChatInput card={card} />
      </CardContent>
    </Card>
  );
}

function BoardColumn({
  column,
  cards,
  now,
}: {
  column: Column;
  cards: BoardCard[];
  now: number;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
        <span className={cn("size-2 rounded-full", COLUMN_ACCENT[column])} />
        {COLUMN_LABELS[column]}
        <span className="text-muted-foreground">{cards.length}</span>
        {column === "done" && (
          <span className="font-normal normal-case text-muted-foreground">
            last 30m
          </span>
        )}
      </h2>
      {cards.map((card) => (
        <SessionCard key={card.sessionId} card={card} now={now} />
      ))}
    </section>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  usePoll(POLL_MS);
  const board: Board = loaderData;
  const now = board.generatedAt;
  const [drafts, setDrafts] = useSessionStorage<Record<string, string>>(
    "seemux:drafts",
    {},
  );
  const setDraft = (sessionId: string, draft: string) =>
    setDrafts((d) => {
      const { [sessionId]: _, ...rest } = d;
      return draft ? { ...rest, [sessionId]: draft } : rest;
    });

  return (
    <DraftsContext.Provider value={{ drafts, setDraft }}>
      <main className="mx-auto flex max-w-[1600px] flex-col gap-6 p-4 sm:p-6">
        <header className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">seemux</span>
          <span className="flex min-w-0 gap-3">
            {board.version && (
              <span className="truncate font-mono" title="Commit being served">
                {board.version}
              </span>
            )}
            <span className="shrink-0">
              updated {new Date(now).toLocaleTimeString()}
            </span>
          </span>
        </header>

        <DispatchBar />
        <DispatchStrip sets={board.dispatches} />

        {board.warnings.map((w) => (
          <p key={w} className="text-sm text-amber-600 dark:text-amber-400">
            {w}
          </p>
        ))}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => (
            <BoardColumn
              key={column}
              column={column}
              cards={board.cards.filter((c) => c.column === column)}
              now={now}
            />
          ))}
        </div>

        {board.orphans.length > 0 && (
          <footer className="flex flex-col gap-2 border-t pt-4 text-xs text-muted-foreground">
            <span>Background sessions with no live parent chat</span>
            <div className="flex flex-wrap gap-1">
              {board.orphans.map((b) => (
                <Badge
                  key={b.id}
                  variant="outline"
                  title={b.needs ?? undefined}
                >
                  <PathSwatch cwd={b.cwd} />
                  {b.name} · {b.state} · {shortPath(b.cwd)}
                </Badge>
              ))}
            </div>
          </footer>
        )}
      </main>
    </DraftsContext.Provider>
  );
}
