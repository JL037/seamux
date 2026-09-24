import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRevalidator } from "react-router";
import {
  GitBranch,
  Layers,
  Maximize2,
  Eye,
  EyeOff,
  Pin,
  PinOff,
  Play,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";

import type { Route } from "./+types/home";
import { ChatModal } from "~/components/chat-modal";
import { ConfigDialog } from "~/components/config-dialog";
import { DispatchBar } from "~/components/dispatch-bar";
import { DispatchStrip, WorkerStatus } from "~/components/dispatch-strip";
import { Markdown } from "~/components/markdown";
import { SubagentSummary } from "~/components/subagent-list";
import { WaitingPanel } from "~/components/waiting-panel";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  closable,
  COLUMN_LABELS,
  COLUMNS,
  type Board,
  type Card as BoardCard,
  type Column,
} from "~/lib/board";
import { loadBoard } from "~/lib/board.server";
import { configOrDefaults } from "~/lib/config.server";
import { releaseFocus, useFocusRestore } from "~/lib/use-focus-restore";
import { useSessionAction } from "~/lib/use-session-action";
import { hashedColor, PALETTE, projectOf } from "~/lib/project-colors";
import {
  useLocalStorage,
  useSessionStorage,
} from "~/lib/use-session-storage";
import { cn } from "~/lib/utils";

const POLL_MS = 3000;

export function meta({}: Route.MetaArgs) {
  return [{ title: "seemux" }];
}

export async function loader() {
  return { board: await loadBoard(), config: configOrDefaults() };
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

// Colours picked for projects, keyed by project path. Kept in this browser
// for now, until seemux has a config of its own.
const ProjectColorsContext = createContext<{
  colors: Record<string, string>;
  setColor: (project: string, color: string | null) => void;
}>({ colors: {}, setColor: () => {} });

// The project's colour, and a picker for it on click.
function PathSwatch({ cwd }: { cwd: string }) {
  const { colors, setColor } = useContext(ProjectColorsContext);
  const project = projectOf(cwd);
  const current = colors[project] ?? hashedColor(project);
  const [open, setOpen] = useState(false);
  const pick = (color: string | null) => {
    setColor(project, color);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Colour for ${shortPath(project)}`}
        title={shortPath(project)}
        className="size-2.5 shrink-0 cursor-pointer rounded-[2px] outline-offset-2"
        style={{ backgroundColor: current }}
      />
      <PopoverContent align="start" className="w-auto gap-2">
        <div className="grid grid-cols-6 gap-1.5">
          {PALETTE.map((color) => (
            <button
              type="button"
              key={color}
              aria-label={color}
              onClick={() => pick(color)}
              className={cn(
                "size-6 cursor-pointer rounded-sm outline-offset-2",
                color === current &&
                  "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        {colors[project] && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="cursor-pointer text-left text-xs text-muted-foreground hover:text-foreground"
          >
            Reset to automatic
          </button>
        )}
      </PopoverContent>
    </Popover>
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
  // Kept across a reload, like the draft, so an open chat stays open.
  const [open, setOpen] = useSessionStorage(
    `seemux:chat-open:${card.sessionId}`,
    false,
  );
  const draft = drafts[card.sessionId] ?? "";
  const onDraftChange = (d: string) => setDraft(card.sessionId, d);
  // A draft is cleared, from state and storage, as it is sent, so a reload
  // mid-send can't bring it back; a failure puts it back.
  const sent = useRef("");
  const takeDraft = () => {
    sent.current = draft;
    setDraft(card.sessionId, "");
    return draft;
  };
  const released = useCallback(() => {
    releaseFocus(`reply:${card.sessionId}`);
    releaseFocus(`chat:${card.sessionId}`);
  }, [card.sessionId]);
  const current = useRef(draft);
  current.current = draft;
  const restore = useCallback(
    () => setDraft(card.sessionId, current.current || sent.current),
    [card.sessionId, setDraft],
  );
  const { submit, pending, error } = useSessionAction(
    card.sessionId,
    released,
    restore,
  );
  const forker = useSessionAction(card.sessionId, released, restore);
  const canSend = card.drivable && !pending && draft.trim().length > 0;
  const send = () => canSend && submit("send", { text: takeDraft() });

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
            data-focus-key={`reply:${card.sessionId}`}
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
        onFork={() =>
          draft.trim() && forker.submit("fork", { text: takeDraft() })
        }
        forking={forker.pending}
      />
    </div>
  );
}

function ActionError({ error }: { error: string }) {
  return <p className="text-destructive">{error}</p>;
}

// Why a WORKING card's stop is disabled, or null when it can be pressed.
function stopBlocked(card: BoardCard): string | null {
  if (!card.turnRunning) {
    return "Only its subagents are running; the chat's own turn has ended, so there is no turn to stop";
  }
  if (!card.drivable) {
    return "Not in a cmux surface, so the board can't press Esc in it";
  }
  return null;
}

// Stop on a WORKING card (Esc into the session), resume on a DONE one.
function CardControl({ card }: { card: BoardCard }) {
  const { submit, pending, error } = useSessionAction(card.sessionId);
  if (card.column === "working") {
    const blocked = stopBlocked(card);
    // A disabled button takes no pointer events, so the span carries the
    // reason for hover.
    return (
      <span title={error ?? blocked ?? "Stop this turn (Esc)"}>
        <Button
          size="icon-xs"
          variant="outline"
          disabled={blocked != null || pending}
          onClick={() => submit("interrupt")}
        >
          <Square />
        </Button>
      </span>
    );
  }
  if (closable(card)) {
    const held = card.closing?.state === "held";
    return (
      <Button
        size="icon-xs"
        variant="outline"
        disabled={
          !card.drivable || pending || card.closing?.state === "cleaning"
        }
        title={
          error ??
          (held
            ? "Close now, without the close-session macro"
            : "Close this chat: the close-session macro runs first, if set, then it moves to Done and can be resumed")
        }
        // No confirmation: a closed chat is resumable from Done.
        onClick={() => submit("close")}
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

// A background session no open chat owns. Play brings it back with
// `claude attach`; X explains how to delete it, since seemux never does.
function OrphanBadge({ orphan }: { orphan: Board["orphans"][number] }) {
  const { submit, pending, error } = useSessionAction(orphan.sessionId);
  const [removing, setRemoving] = useState(false);
  return (
    <Badge
      variant="outline"
      className="h-6 pr-0.5"
      title={orphan.needs ?? undefined}
    >
      <PathSwatch cwd={orphan.cwd} />
      {orphan.name} · {orphan.state} · {shortPath(orphan.cwd)}
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={pending}
        title={error ?? "Resume in a new cmux workspace (claude attach)"}
        onClick={() => submit("attach")}
      >
        <Play />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        title="How to delete this session"
        onClick={() => setRemoving(true)}
      >
        <X />
      </Button>
      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {orphan.name}</DialogTitle>
            <DialogDescription>
              seemux never deletes sessions. To remove this one for good, run
              this in any Claude Code chat, or without the <code>!</code> in a
              terminal:
            </DialogDescription>
          </DialogHeader>
          <pre className="rounded-md bg-muted px-3 py-2 font-mono text-sm select-all">
            ! claude rm {orphan.id}
          </pre>
          <p className="text-sm text-muted-foreground">
            This deletes the session, and its worktree when that is safe. To
            keep it, resume it with play instead.
          </p>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </Badge>
  );
}

// Pins a long-running chat into its own column, or takes it back out. A
// closed chat can't be pinned; one pinned before it closed can still be
// unpinned.
function PinToggle({ card }: { card: BoardCard }) {
  const { submit, pending, error } = useSessionAction(card.sessionId);
  if (card.column === "done" && !card.pinned) return null;
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      disabled={pending}
      title={
        error ??
        (card.pinned
          ? "Unpin: back to its column, and off the board 30m after it closes"
          : "Pin: keep it in Pinned, whatever its state, for as long as it exists")
      }
      onClick={() => submit(card.pinned ? "unpin" : "pin")}
    >
      {card.pinned ? <PinOff /> : <Pin />}
    </Button>
  );
}

// The card's last reply, as markdown, clipped to a few lines; faded at the
// bottom when there's more, which the chat shows in full.
function ReplyExcerpt({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <div
      ref={ref}
      className={cn(
        "prose prose-sm max-h-40 max-w-none overflow-hidden break-words text-xs dark:prose-invert",
        "prose-headings:my-1 prose-headings:text-xs prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-hr:my-2",
        "prose-pre:my-1 prose-pre:bg-muted prose-pre:p-2 prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none",
        "prose-table:my-1 [&>:first-child]:mt-0",
        clipped &&
          "[mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
      )}
    >
      <Markdown>{text}</Markdown>
    </div>
  );
}

function SessionCard({ card, now }: { card: BoardCard; now: number }) {
  return (
    <Card size="sm" className={cn(card.column === "done" && "opacity-70")}>
      {/* A bounded column, so a long path truncates rather than widening the
          header and pushing the title's buttons off the card. */}
      <CardHeader className="grid-cols-[minmax(0,1fr)]">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {card.pinned && (
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  COLUMN_ACCENT[card.column],
                )}
                title={COLUMN_LABELS[card.column]}
              />
            )}
            <span className="truncate">{card.name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <PinToggle card={card} />
            <CardControl card={card} />
          </span>
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
        {card.lastReply && <ReplyExcerpt text={card.lastReply} />}
        {card.closing && (
          <p
            className={cn(
              "rounded-md px-2 py-1",
              card.closing.state === "held"
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {card.closing.state === "cleaning"
              ? "Closing: running the close-session macro, then it exits."
              : card.closing.note}
          </p>
        )}
        <WaitingPanel card={card} />
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

// Pinned sits left of the state columns; its cards show their state as a dot.
type BoardColumnKey = Column | "pinned";

const PINNED_ACCENT = "bg-violet-500";

// Spelled out so Tailwind sees each class.
const XL_GRID_COLS: Record<number, string> = {
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
};

function BoardColumn({
  column,
  cards,
  now,
}: {
  column: BoardColumnKey;
  cards: BoardCard[];
  now: number;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
        <span
          className={cn(
            "size-2 rounded-full",
            column === "pinned" ? PINNED_ACCENT : COLUMN_ACCENT[column],
          )}
        />
        {column === "pinned" ? "Pinned" : COLUMN_LABELS[column]}
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
  useFocusRestore();
  const board: Board = loaderData.board;
  const { config } = loaderData;
  const now = board.generatedAt;
  // Pinned only takes a column while something is pinned.
  const pinned = board.cards.filter((c) => c.pinned);
  // Done is hidden until asked for, and the choice outlives the tab.
  const [showDone, setShowDone] = useLocalStorage("seemux:show-done", false);
  const doneCount = board.cards.filter(
    (c) => !c.pinned && c.column === "done",
  ).length;
  const columns = COLUMNS.filter((c) => showDone || c !== "done");
  const columnCount = columns.length + (pinned.length > 0 ? 1 : 0);
  const [drafts, setDrafts] = useSessionStorage<Record<string, string>>(
    "seemux:drafts",
    {},
  );
  const setDraft = (sessionId: string, draft: string) =>
    setDrafts((d) => {
      const { [sessionId]: _, ...rest } = d;
      return draft ? { ...rest, [sessionId]: draft } : rest;
    });
  const [colors, setColors] = useLocalStorage<Record<string, string>>(
    "seemux:project-colors",
    {},
  );
  const setColor = (project: string, color: string | null) =>
    setColors((c) => {
      const { [project]: _, ...rest } = c;
      return color ? { ...rest, [project]: color } : rest;
    });

  return (
    <DraftsContext.Provider value={{ drafts, setDraft }}>
      <ProjectColorsContext.Provider value={{ colors, setColor }}>
        <main className="mx-auto flex max-w-[1600px] flex-col gap-6 p-4 sm:p-6">
          <header className="flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="font-semibold text-foreground">seemux</span>
              <ConfigDialog config={config} />
            </span>
            <span className="flex min-w-0 items-center gap-3">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setShowDone(!showDone)}
                title={
                  showDone
                    ? "Hide chats closed in the last 30m"
                    : "Show chats closed in the last 30m"
                }
              >
                {showDone ? <EyeOff /> : <Eye />}
                {showDone ? "Hide done" : `Show done (${doneCount})`}
              </Button>
              {board.version && (
                <span
                  className="truncate font-mono"
                  title="Commit being served"
                >
                  {board.version}
                </span>
              )}
              <span className="shrink-0">
                updated {new Date(now).toLocaleTimeString()}
              </span>
            </span>
          </header>

          <DispatchBar
            directories={config.directories}
            worktreeByDefault={config.worktreeByDefault}
          />
          <DispatchStrip sets={board.dispatches} />

          {board.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-600 dark:text-amber-400">
              {w}
            </p>
          ))}

          <div
            className={cn(
              "grid grid-cols-1 gap-4 sm:grid-cols-2",
              XL_GRID_COLS[columnCount],
            )}
          >
            {pinned.length > 0 && (
              <BoardColumn column="pinned" cards={pinned} now={now} />
            )}
            {columns.map((column) => (
              <BoardColumn
                key={column}
                column={column}
                cards={board.cards.filter(
                  (c) => !c.pinned && c.column === column,
                )}
                now={now}
              />
            ))}
          </div>

          {board.orphans.length > 0 && (
            <footer className="flex flex-col gap-2 border-t pt-4 text-xs text-muted-foreground">
              <span title="`claude agents` names no parent, so a background session belongs to an open chat in its directory that started before it. These match none: their chat has closed, or runs in another directory.">
                Background sessions not matched to an open chat
              </span>
              <div className="flex flex-wrap gap-1">
                {board.orphans.map((b) => (
                  <OrphanBadge key={b.id} orphan={b} />
                ))}
              </div>
            </footer>
          )}
        </main>
      </ProjectColorsContext.Provider>
    </DraftsContext.Provider>
  );
}
