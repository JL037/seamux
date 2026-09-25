import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFetcher, useRevalidator } from "react-router";
import {
  GitBranch,
  CircleCheck,
  Globe,
  Layers,
  LoaderCircle,
  Maximize2,
  Eye,
  EyeOff,
  Pin,
  PinOff,
  Play,
  SendHorizontal,
  Square,
  Trash2,
  Wifi,
  X,
} from "lucide-react";

import type { Route } from "./+types/home";
import type { ActionResult } from "./session-action";
import { ChatModal } from "~/components/chat-modal";
import { ConfigDialog } from "~/components/config-dialog";
import { ContextBar } from "~/components/context-bar";
import { DispatchBar } from "~/components/dispatch-bar";
import { DispatchStrip, WorkerStatus } from "~/components/dispatch-strip";
import { Markdown } from "~/components/markdown";
import {
  productNameFromMatches,
  useProductName,
} from "~/components/product-name";
import { SeamuxMark } from "~/components/seamux-mark";
import { SubagentSummary } from "~/components/subagent-list";
import { ThemeToggle } from "~/components/theme-toggle";
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
import { ENGINE_LABELS } from "~/lib/config";
import { configOrDefaults } from "~/lib/config.server";
import { installedEngines } from "~/lib/drive.server";
import { startQueue } from "~/lib/queue.server";
import { remoteStatus } from "~/lib/remote.server";
import { releaseFocus, useFocusRestore } from "~/lib/use-focus-restore";
import { useSessionAction } from "~/lib/use-session-action";
import { hashedColor, PALETTE, projectOf } from "~/lib/project-colors";
import {
  useLocalStorage,
  useSessionStorage,
} from "~/lib/use-session-storage";
import { cn } from "~/lib/utils";

const POLL_MS = 3000;

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: productNameFromMatches(matches) }];
}

export async function loader({ request }: Route.LoaderArgs) {
  startQueue();
  return {
    board: await loadBoard(),
    config: configOrDefaults(),
    engines: installedEngines(),
    remote: remoteStatus(process.cwd(), request.headers.get("host")),
  };
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
  working: "bg-brand-cyan",
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

function firstWords(text: string, count: number): string {
  const words = text.split(/\s+/);
  return words.length > count
    ? `${words.slice(0, count).join(" ")}…`
    : text;
}

function shortPath(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, "~");
}

// Colours picked for projects, keyed by project path. Kept in this browser
// for now, until seamux has a config of its own.
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
// longer messages. Both send through cmux into the session's surface, or,
// while the chat works or already has messages waiting, into seamux's queue.
function ChatInput({
  card,
  open,
  setOpen,
}: {
  card: BoardCard;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { drafts, setDraft } = useContext(DraftsContext);
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
  const queueing = card.column === "working" || card.boardQueue.length > 0;
  const send = () =>
    canSend && submit(queueing ? "queue" : "send", { text: takeDraft() });

  // A single-line input would flatten a multiline draft, and editing it there
  // would drop the line breaks for good. So a multiline draft is shown, read
  // only, across the card's full width, and opens the full view instead of
  // sending: a long message waiting to go is visible at a glance.
  const lines = draft.split("\n").length;
  const multiline = lines > 1;
  const expand = (
    <Button
      type="button"
      size={multiline ? "icon-xs" : "icon-sm"}
      variant={multiline ? "default" : "ghost"}
      title="Open full view"
      onClick={() => setOpen(true)}
    >
      <Maximize2 />
    </Button>
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <form
            className="flex items-center gap-1 rounded-t-lg border bg-background p-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (multiline) setOpen(true);
              else send();
            }}
          >
            <input
              data-focus-key={`reply:${card.sessionId}`}
              value={multiline ? draft.split("\n")[0] : draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onClick={multiline ? () => setOpen(true) : undefined}
              readOnly={multiline}
              placeholder={
                !card.drivable
                  ? "Not in a cmux surface"
                  : queueing
                    ? "Queue a reply"
                    : "Reply"
              }
              disabled={!card.drivable}
              className={cn(
                "min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground",
                multiline && "cursor-pointer",
              )}
            />
            {multiline ? (
              <>
                <button
                  type="button"
                  title="Open full view"
                  onClick={() => setOpen(true)}
                  className="shrink-0 cursor-pointer text-[10px] tabular-nums text-muted-foreground hover:text-foreground"
                >
                  {lines} lines
                </button>
                {expand}
              </>
            ) : (
              <Button
                type="submit"
                size="icon-xs"
                disabled={!canSend}
                title={queueing ? "Queue, to send once this turn ends" : "Send"}
              >
                <SendHorizontal />
              </Button>
            )}
          </form>
          <ContextBar context={card.context} />
        </div>
        {!multiline && expand}
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
        queueing={queueing}
        pending={pending}
        error={error ?? forker.error}
        onFork={
          card.engine === "claude"
            ? () => draft.trim() && forker.submit("fork", { text: takeDraft() })
            : null
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

// A background session no open chat owns. The pill opens a dialog that
// resumes it with `claude attach`, or deletes it by dispatching a chat that
// runs `claude rm`, since seamux never deletes.
function OrphanBadge({ orphan }: { orphan: Board["orphans"][number] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { submit, pending, error } = useSessionAction(orphan.sessionId, close);
  return (
    <>
      <Badge
        variant="outline"
        className="h-6 cursor-pointer hover:bg-muted"
        title={orphan.needs ?? "Resume or delete"}
        render={<button type="button" onClick={() => setOpen(true)} />}
      >
        <PathSwatch cwd={orphan.cwd} />
        {orphan.name} · {orphan.state} · {shortPath(orphan.cwd)}
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{orphan.name}</DialogTitle>
            <DialogDescription>
              A background session, {orphan.state}, in{" "}
              {shortPath(orphan.cwd)}. No open chat owns it.
            </DialogDescription>
          </DialogHeader>
          <pre className="rounded-md bg-muted px-3 py-2 font-mono text-sm select-all">
            claude rm {orphan.id}
          </pre>
          <p className="text-sm text-muted-foreground">
            Resume brings it back in a new cmux workspace with its
            conversation. Delete starts a chat that runs this command, which
            removes the session and its worktree, and stops to ask before
            discarding unpushed work. seamux never deletes on its own.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => submit("delete")}
            >
              <Trash2 />
              Delete this session
            </Button>
            <Button disabled={pending} onClick={() => submit("attach")}>
              <Play />
              Resume this session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// The card's name, renamed in place by double-clicking it. A pinned card's
// name is also its drag handle. The new name shows at once, and stays until
// the board reports it or the rename fails.
function SessionName({ card }: { card: BoardCard }) {
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const forget = useCallback(() => setSent(null), []);
  const { submit, pending, error } = useSessionAction(
    card.sessionId,
    undefined,
    forget,
  );
  useEffect(() => {
    if (sent === null) return;
    if (card.name === sent) return setSent(null);
    // Claude Code has had long enough to report it; show what it says.
    const timer = setTimeout(forget, 10_000);
    return () => clearTimeout(timer);
  }, [card.name, sent, forget]);

  // Enter ends the edit, and the input's blur as it goes must not end it
  // again.
  const finished = useRef(false);
  const name = sent ?? card.name;
  if (editing) {
    const finish = (value: string | null) => {
      if (finished.current) return;
      finished.current = true;
      setEditing(false);
      const next = value?.trim();
      if (!next || next === name) return;
      setSent(next);
      submit("rename", { name: next });
    };
    return (
      <input
        autoFocus
        defaultValue={name}
        maxLength={100}
        aria-label="Session name"
        className="min-w-0 flex-1 rounded-sm bg-muted px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => finish(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(e.currentTarget.value);
          else if (e.key === "Escape") {
            // Esc here cancels the edit, not whatever dialog holds the card.
            e.stopPropagation();
            finish(null);
          }
        }}
      />
    );
  }
  const title =
    error ??
    (card.pinned
      ? "Drag to reorder Pinned, double-click to rename"
      : "Double-click to rename");
  return (
    <span
      draggable={card.pinned}
      onDragStart={
        card.pinned ? (e) => startPinDrag(e, card.sessionId) : undefined
      }
      onDoubleClick={() => {
        finished.current = false;
        setEditing(true);
      }}
      className={cn(
        "truncate",
        card.pinned && "cursor-grab active:cursor-grabbing",
        pending && "opacity-60",
        error && "text-destructive",
      )}
      title={title}
    >
      {name}
    </span>
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

// Clipped to its box, and faded on the side where there is more. `from`
// says which end stays in view: a prompt reads from its start, a reply from
// its end, so the two fade toward each other.
function Faded({
  from,
  className,
  children,
}: {
  from: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setClipped(el.scrollHeight > el.clientHeight + 1);
      if (from === "end") el.scrollTop = el.scrollHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [from, children]);
  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden",
        clipped &&
          (from === "start"
            ? "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
            : "[mask-image:linear-gradient(to_top,black_70%,transparent)]"),
        className,
      )}
    >
      {children}
    </div>
  );
}

// The end of the card's last reply, as markdown: what was done, or what it
// asks. The chat shows it in full.
function ReplyExcerpt({ text, cwd }: { text: string; cwd: string }) {
  return (
    <Faded
      from="end"
      className={cn(
        "prose prose-sm max-h-40 max-w-none break-words text-xs dark:prose-invert",
        "prose-headings:my-1 prose-headings:text-xs prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-hr:my-2",
        "prose-pre:my-1 prose-pre:bg-muted prose-pre:p-2 prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none",
        "prose-table:my-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0",
      )}
    >
      <Markdown base={cwd}>{text}</Markdown>
    </Faded>
  );
}

// A hairline along a card's top edge for the states that want attention.
const CARD_EDGE: Partial<Record<Column, string>> = {
  waiting: "before:bg-amber-500",
  working: "before:bg-brand-ramp",
};

function SessionCard({ card, now }: { card: BoardCard; now: number }) {
  // Kept across a reload, like the draft, so an open chat stays open.
  const [chatOpen, setChatOpen] = useSessionStorage(
    `seamux:chat-open:${card.sessionId}`,
    false,
  );
  return (
    <Card
      size="sm"
      className={cn(
        "relative shadow-sm transition-shadow before:absolute before:inset-x-0 before:top-0 before:h-0.5 hover:shadow-md dark:shadow-black/20",
        CARD_EDGE[card.column],
        card.column === "done" && "opacity-70",
      )}
    >
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
            <SessionName card={card} />
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
          {card.engine !== "claude" && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              {ENGINE_LABELS[card.engine]}
            </Badge>
          )}
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
          <Faded from="start" className="max-h-12 text-muted-foreground">
            <span className="font-medium text-foreground">You: </span>
            {card.lastPrompt}
          </Faded>
        )}
        {card.lastReply && <ReplyExcerpt text={card.lastReply} cwd={card.cwd} />}
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
        <CardState
          column={card.column}
          queued={card.terminalQueue.length + card.boardQueue.length}
          onOpen={() => setChatOpen(true)}
        />
        <ChatInput card={card} open={chatOpen} setOpen={setChatOpen} />
      </CardContent>
    </Card>
  );
}

// Waiting shows no state here: the card already carries the prompt or tool
// that is waiting, and done cards are over. Anything queued shows as +N, and
// the line then opens the chat, where the queue is listed.
function CardState({
  column,
  queued,
  onOpen,
}: {
  column: Column;
  queued: number;
  onOpen: () => void;
}) {
  const state =
    column === "idle" ? (
      <>
        <CircleCheck className="size-3.5" />
        ready
      </>
    ) : column === "working" ? (
      <>
        <LoaderCircle className="size-3.5 animate-spin" />
        working
      </>
    ) : null;
  const tone =
    column === "working" ? "text-brand-cyan" : "text-muted-foreground";
  if (queued === 0) {
    return (
      state && (
        <span className={cn("flex items-center gap-1.5", tone)}>{state}</span>
      )
    );
  }
  if (column === "done") return null;
  const when =
    column === "idle"
      ? "seamux sends it on its next check"
      : column === "working"
        ? "sent once this turn ends"
        : "sent once the chat is ready again";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${queued} queued, ${when}. Open the chat to see or edit it`}
      className={cn("flex w-fit items-center gap-1.5 hover:underline", tone)}
    >
      {state}
      <span>{state ? `+${queued}` : `+${queued} queued`}</span>
    </button>
  );
}

// A pinned card is dragged by its name, carrying its session id. The whole
// card follows the pointer, held where it was picked up.
const PIN_DRAG = "application/x-seamux-pin";

function startPinDrag(e: React.DragEvent<HTMLElement>, sessionId: string) {
  e.dataTransfer.setData(PIN_DRAG, sessionId);
  e.dataTransfer.effectAllowed = "move";
  const card = e.currentTarget.closest<HTMLElement>("[data-pin-card]");
  if (card) {
    const box = card.getBoundingClientRect();
    e.dataTransfer.setDragImage(card, e.clientX - box.left, e.clientY - box.top);
  }
}

// `ids` with `id` moved to just before `before`, or to the end.
function movedBefore(ids: string[], id: string, before: string): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = before ? rest.indexOf(before) : -1;
  rest.splice(at === -1 ? rest.length : at, 0, id);
  return rest;
}

// Pinned cards in Jakob's order, which he changes by dragging a card's name.
// A line marks where it will land; the move shows at once, ahead of the
// board that confirms it.
function PinnedCards({ cards, now }: { cards: BoardCard[]; now: number }) {
  const fetcher = useFetcher<ActionResult>();
  const [dropAt, setDropAt] = useState<number | null>(null);
  const ids = cards.map((c) => c.sessionId);
  const moving = fetcher.formData;
  const order = moving
    ? movedBefore(
        ids,
        String(moving.get("moved")),
        String(moving.get("before")),
      )
    : ids;
  const shown = order.flatMap((id) => cards.find((c) => c.sessionId === id) ?? []);
  const isPinDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(PIN_DRAG);

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(e) => {
        if (!isPinDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropAt(null);
        }
      }}
      onDragEnd={() => setDropAt(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(PIN_DRAG);
        const at = dropAt;
        setDropAt(null);
        if (!id || at === null || !order.includes(id)) return;
        e.preventDefault();
        const rest = order.filter((x) => x !== id);
        const before =
          rest[order.slice(0, at).filter((x) => x !== id).length] ?? "";
        if (movedBefore(order, id, before).join() === order.join()) return;
        fetcher.submit(
          { intent: "pin-move", moved: id, before },
          { method: "post", action: `/sessions/${id}/action` },
        );
      }}
    >
      {shown.map((card, i) => (
        <div
          key={card.sessionId}
          data-pin-card
          className="relative"
          onDragOver={(e) => {
            if (!isPinDrag(e)) return;
            const box = e.currentTarget.getBoundingClientRect();
            setDropAt(e.clientY > box.top + box.height / 2 ? i + 1 : i);
          }}
        >
          {dropAt === i && <DropLine edge="top" />}
          {dropAt === i + 1 && i === shown.length - 1 && (
            <DropLine edge="bottom" />
          )}
          <SessionCard card={card} now={now} />
        </div>
      ))}
      {fetcher.data?.error && (
        <p className="text-xs text-destructive">{fetcher.data.error}</p>
      )}
    </div>
  );
}

// Centred in the gap between two cards.
function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full",
        PINNED_ACCENT,
        edge === "top" ? "-top-[7px]" : "-bottom-[7px]",
      )}
    />
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
  const label = column === "pinned" ? "Pinned" : COLUMN_LABELS[column];
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="flex items-center gap-2 border-b pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span
          className={cn(
            "size-2 rounded-full",
            column === "pinned" ? PINNED_ACCENT : COLUMN_ACCENT[column],
            column === "working" && cards.length > 0 && "animate-pulse",
          )}
        />
        <span className="text-foreground">{label}</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[0.7rem] tabular-nums">
          {cards.length}
        </span>
        {column === "done" && (
          <span className="font-normal normal-case tracking-normal">
            last 30m
          </span>
        )}
      </h2>
      {column === "pinned" ? (
        <PinnedCards cards={cards} now={now} />
      ) : (
        cards.map((card) => (
          <SessionCard key={card.sessionId} card={card} now={now} />
        ))
      )}
      {cards.length === 0 && (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          Nothing {label.toLowerCase()}
        </p>
      )}
    </section>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const name = useProductName();
  usePoll(POLL_MS);
  useFocusRestore();
  const board: Board = loaderData.board;
  const { config, engines, remote } = loaderData;
  const now = board.generatedAt;
  // Pinned only takes a column while something is pinned.
  const pinned = board.cards.filter((c) => c.pinned);
  // Done is hidden until asked for, and the choice outlives the tab.
  const [showDone, setShowDone] = useLocalStorage("seamux:show-done", false);
  const doneCount = board.cards.filter(
    (c) => !c.pinned && c.column === "done",
  ).length;
  const columns = COLUMNS.filter((c) => showDone || c !== "done");
  const columnCount = columns.length + (pinned.length > 0 ? 1 : 0);
  const [drafts, setDrafts] = useSessionStorage<Record<string, string>>(
    "seamux:drafts",
    {},
  );
  const setDraft = (sessionId: string, draft: string) =>
    setDrafts((d) => {
      const { [sessionId]: _, ...rest } = d;
      return draft ? { ...rest, [sessionId]: draft } : rest;
    });
  const [colors, setColors] = useLocalStorage<Record<string, string>>(
    "seamux:project-colors",
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
          <header className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="flex items-center gap-2.5">
                <SeamuxMark size={32} />
                <span className="text-xl font-bold tracking-tight text-foreground">
                  {name}
                </span>
              </span>
              <ConfigDialog
                config={config}
                engines={engines}
                remote={remote}
              />
              <ThemeToggle />
            </span>
            <span className="flex min-w-0 items-center gap-3">
              {remote.enabled && remote.mdns.listening && (
                <a
                  href={remote.mdns.url}
                  className="flex shrink-0 items-center gap-1 text-xs text-foreground"
                  title={`mDNS is on: the board answers the network at ${remote.mdns.url}`}
                >
                  <Wifi className="size-3.5" />
                  LAN
                </a>
              )}
              {remote.pid && remote.domain && (
                <a
                  href={`https://${remote.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 text-xs text-foreground"
                  title={`Remote access is on: the tunnel serves this board at ${remote.domain}`}
                >
                  <Globe className="size-3.5" />
                  Remote
                </a>
              )}
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
                  className="truncate font-mono text-xs opacity-70"
                  title={firstWords(board.version.subject, 12)}
                >
                  {board.version.hash}
                </span>
              )}
              <span className="shrink-0 text-xs tabular-nums">
                updated {new Date(now).toLocaleTimeString()}
              </span>
            </span>
          </header>

          <DispatchBar
            directories={config.directories}
            worktreeByDefault={config.worktreeByDefault}
            defaultEngine={config.defaultEngine}
            engines={engines}
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
