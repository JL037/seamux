import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { GitFork, SendHorizontal } from "lucide-react";

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
import { SubagentDetail } from "~/components/subagent-list";
import { Textarea } from "~/components/ui/textarea";
import type { Card, ChatMessage } from "~/lib/board";
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
  pending,
  error,
  onFork,
  forking,
}: {
  card: Card;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  canSend: boolean;
  pending: boolean;
  error: string | null;
  onFork: () => void;
  forking: boolean;
}) {
  const fetcher = useFetcher<{ messages: ChatMessage[] }>();
  const url = `/sessions/${card.sessionId}/messages`;
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  // Remember where the conversation was scrolled to, so a reload lands back
  // there rather than at the end. Reading the end is remembered as such, so
  // messages that arrive meanwhile still show.
  useEffect(() => {
    if (!open) return;
    const key = scrollKey(card.sessionId);
    const save = () => {
      const el = scrollerRef.current;
      if (!el) return;
      const atEnd =
        el.scrollHeight - el.scrollTop - el.clientHeight < AT_END_PX;
      try {
        if (atEnd) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, String(el.scrollTop));
      } catch {}
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [open, card.sessionId]);

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
    if (messages && !restored.current) {
      restored.current = true;
      const key = scrollKey(card.sessionId);
      let top: string | null = null;
      try {
        top = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
      } catch {}
      if (top !== null && scrollerRef.current) {
        scrollerRef.current.scrollTop = Number(top);
        return;
      }
    }
    endRef.current?.scrollIntoView({ block: "end" });
    // Only a change in how many messages there are should move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{card.name}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {card.cwd}
            {card.branch && ` · ${card.branch}`}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 border-y">
          <div
            ref={scrollerRef}
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
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    m.role === "user"
                      ? "self-end whitespace-pre-wrap break-words bg-primary text-primary-foreground"
                      : "prose prose-sm self-start bg-muted dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-background prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none",
                  )}
                >
                  {m.role === "user" ? m.text : <Markdown>{m.text}</Markdown>}
                </div>
              ))}
            </div>
            <div ref={endRef} />
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

        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <Textarea
              autoFocus
              data-focus-key={`chat:${card.sessionId}`}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder={
                card.drivable
                  ? "Next message (⌘↵ to send), or a tangent to fork"
                  : "Not running: write a tangent to fork from this chat"
              }
              className="min-h-32 resize-y rounded-b-none"
            />
            <ContextBar context={card.context} className="border-input" />
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              disabled={forking || !draft.trim()}
              onClick={onFork}
              title="Start a new session with this chat's context and this message"
            >
              <GitFork />
              {forking ? "Forking…" : "Fork"}
            </Button>
            <Button disabled={!canSend} onClick={onSend} title="Send (⌘↵)">
              <SendHorizontal />
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
