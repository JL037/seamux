import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Check, GitFork, Pencil, SendHorizontal, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { ContextBar } from "~/components/context-bar";
import { Markdown } from "~/components/markdown";
import { useSlashMenu } from "~/components/slash-menu";
import { SubagentDetail } from "~/components/subagent-list";
import { Textarea } from "~/components/ui/textarea";
import type { Card, ChatMessage, QueuedMessage } from "~/lib/board";
import { useCoarsePointer } from "~/lib/use-pointer";
import { useSessionAction } from "~/lib/use-session-action";
import { cn } from "~/lib/utils";

const POLL_MS = 3000;
// Within this many pixels of the end counts as reading the latest message.
const AT_END_PX = 40;

function scrollKey(sessionId: string) {
  return `seamux:chat-scroll:${sessionId}`;
}

// Full-screen view of one card: the conversation, and room to write the
// next message. The draft is shared with the card's inline input.
export function ChatModal({
  card,
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onSend,
  canSend,
  queueing,
  pending,
  error,
  onFork,
  forking,
  title,
}: {
  card: Card;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  canSend: boolean;
  queueing: boolean;
  pending: boolean;
  error: string | null;
  // null when the chat's agent can't fork: only Claude Code can.
  onFork: (() => void) | null;
  forking: boolean;
  // The chat's name, renamable here, where a double-click can't reach on a
  // phone.
  title?: ReactNode;
}) {
  const coarse = useCoarsePointer();
  const fetcher = useFetcher<{ messages: ChatMessage[] }>();
  const url = `/sessions/${card.sessionId}/messages`;
  // The dialog mounts its content a render or two after it opens, so the
  // scroller is state: effects that need it rerun once it exists.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const restored = useRef(false);

  // Remember where the conversation was scrolled to, so a reload lands back
  // there rather than at the end. Reading the end is remembered as such, so
  // messages that arrive meanwhile still show.
  useEffect(() => {
    if (!open || !scroller) return;
    const el = scroller;
    const key = scrollKey(card.sessionId);
    const save = () => {
      const atEnd =
        el.scrollHeight - el.scrollTop - el.clientHeight < AT_END_PX;
      try {
        if (atEnd) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, String(el.scrollTop));
      } catch {}
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [open, scroller, card.sessionId]);

  useEffect(() => {
    if (!open) return;
    fetcher.load(url);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetcher.load(url);
    }, POLL_MS);
    return () => clearInterval(id);
    // fetcher is a new object each render; the url is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url]);

  const messages = fetcher.data?.messages;
  const count = messages?.length ?? 0;
  useEffect(() => {
    if (!open || !scroller) return;
    if (messages && !restored.current) {
      restored.current = true;
      const key = scrollKey(card.sessionId);
      let top: string | null = null;
      try {
        top = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
      } catch {}
      if (top !== null) {
        scroller.scrollTop = Number(top);
        return;
      }
    }
    scroller.scrollTop = scroller.scrollHeight;
    // Opening the chat, or a change in how many messages there are, moves the
    // view to the end; nothing else should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scroller, count]);

  const input = useRef<HTMLTextAreaElement>(null);
  const slash = useSlashMenu({
    sessionId: card.sessionId,
    enabled: open && card.drivable && card.engine === "claude",
    draft,
    setDraft: onDraftChange,
    anchor: input,
  });

  // Sending returns to the board; a failed send shows on the card, with the
  // draft put back.
  const send = () => {
    if (!canSend) return;
    onSend();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // On a phone, open on the conversation rather than raising the
        // keyboard over it.
        initialFocus={coarse ? true : input}
        className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-4 sm:max-w-5xl max-md:h-dvh! max-md:w-screen! max-md:max-w-none! max-md:rounded-none max-md:pt-[max(1rem,env(safe-area-inset-top))] max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:ring-0"
      >
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-1 pr-8">
            {title ?? card.name}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {card.cwd}
            {card.branch && ` · ${card.branch}`}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 border-y">
          <div
            ref={setScroller}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
          >
            {!messages && fetcher.state !== "idle" && (
              <p className="text-muted-foreground">Loading conversation…</p>
            )}
            {messages?.length === 0 && (
              <p className="text-muted-foreground">No messages yet.</p>
            )}
            <div className="flex flex-col gap-3">
              {messages?.map((m, i) => (
                <div
                  key={`${m.at}-${i}`}
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm max-md:text-base",
                    m.role === "user"
                      ? "self-end whitespace-pre-wrap break-words bg-primary text-primary-foreground"
                      : "prose prose-sm max-md:prose-base self-start bg-muted dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none",
                  )}
                >
                  {m.role === "user" ? m.text : <Markdown base={card.cwd}>{m.text}</Markdown>}
                </div>
              ))}
            </div>
          </div>
          {card.subagents.length > 0 && (
            <aside className="hidden w-72 shrink-0 overflow-y-auto border-l px-4 py-3 md:block">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Subagents
              </h3>
              <SubagentDetail subagents={card.subagents} now={Date.now()} />
            </aside>
          )}
        </div>

        {/* The side panel has no room below md: a fold instead. */}
        {card.subagents.length > 0 && (
          <details className="max-h-56 shrink-0 overflow-y-auto md:hidden">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Subagents ({card.subagents.length})
            </summary>
            <div className="pt-2">
              <SubagentDetail subagents={card.subagents} now={Date.now()} />
            </div>
          </details>
        )}

        <QueuedList card={card} />

        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="relative flex min-w-0 flex-1 flex-col">
            {slash.menu}
            <Textarea
              ref={input}
              data-focus-key={`chat:${card.sessionId}`}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (slash.onKeyDown(e)) return;
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                !onFork
                  ? card.drivable
                    ? queueing
                      ? "Next message (⌘↵ to queue it for when this turn ends)"
                      : "Next message (⌘↵ to send)"
                    : "Not running"
                  : !card.drivable
                    ? "Not running: write a tangent to fork from this chat"
                    : queueing
                      ? "Next message (⌘↵ to queue it for when this turn ends), or a tangent to fork"
                      : "Next message (⌘↵ to send), or a tangent to fork"
              }
              className="max-h-[30dvh] min-h-20 resize-y overflow-y-auto rounded-b-none border-b-0 max-md:focus-visible:border-input max-md:focus-visible:ring-0 md:max-h-[40dvh] md:min-h-32"
            />
            <ContextBar context={card.context} className="border-input" />
          </div>
          <div className="flex justify-end gap-2 md:flex-col">
            {onFork && (
              <Button
                variant="outline"
                disabled={forking || !draft.trim()}
                onClick={onFork}
                title="Start a new session with this chat's context and this message"
              >
                <GitFork />
                {forking ? "Forking…" : "Fork"}
              </Button>
            )}
            <Button
              disabled={!canSend}
              onClick={send}
              title={
                queueing ? "Queue, to send once this turn ends (⌘↵)" : "Send (⌘↵)"
              }
            >
              <SendHorizontal />
              {pending
                ? queueing
                  ? "Queueing…"
                  : "Sending…"
                : queueing
                  ? "Queue"
                  : "Send"}
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

// What waits for the chat's turn to end. Claude Code's own queue, typed in
// the terminal, goes first and can only be read here; seamux's queue follows,
// one message per turn, and can be edited, sent now, or removed.
function QueuedList({ card }: { card: Card }) {
  if (card.terminalQueue.length === 0 && card.boardQueue.length === 0) {
    return null;
  }
  return (
    <section className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Queued
      </h3>
      {card.terminalQueue.map((text, i) => (
        <div
          key={`terminal-${i}`}
          className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground"
          title="Typed in the terminal, so Claude Code holds it"
        >
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {text}
          </p>
          <span className="shrink-0 text-xs">in the terminal</span>
        </div>
      ))}
      {card.boardQueue.map((m) => (
        <QueuedItem key={m.id} card={card} message={m} />
      ))}
    </section>
  );
}

function QueuedItem({ card, message }: { card: Card; message: QueuedMessage }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const edit = useSessionAction(card.sessionId, () => setEditing(false));
  const other = useSessionAction(card.sessionId);
  const id = String(message.id);
  const save = () =>
    text.trim() && edit.submit("queue-edit", { id, text: text.trim() });
  const error = edit.error ?? other.error;

  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        {editing ? (
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                // Cancel the edit, not the whole modal.
                e.stopPropagation();
                setEditing(false);
              }
            }}
            className="min-h-20 flex-1 resize-y"
          />
        ) : (
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {message.text}
          </p>
        )}
        <div className="flex shrink-0 gap-1">
          {editing ? (
            <>
              <Button
                size="icon-xs"
                disabled={edit.pending || !text.trim()}
                onClick={save}
                title="Save (⌘↵)"
              >
                <Check />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setEditing(false)}
                title="Cancel (Esc)"
              >
                <X />
              </Button>
            </>
          ) : (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => {
                  setText(message.text);
                  setEditing(true);
                }}
                title="Edit"
              >
                <Pencil />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!card.drivable || other.pending}
                onClick={() => other.submit("queue-send", { id })}
                title="Send now: Claude Code takes it at its next step"
              >
                <SendHorizontal />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={other.pending}
                onClick={() => other.submit("queue-drop", { id })}
                title="Remove from the queue"
              >
                <X />
              </Button>
            </>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
