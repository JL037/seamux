import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { SendHorizontal } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { SubagentDetail } from "~/components/subagent-list";
import { Textarea } from "~/components/ui/textarea";
import type { Card, ChatMessage } from "~/lib/board";
import { cn } from "~/lib/utils";

const POLL_MS = 3000;

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
}) {
  const fetcher = useFetcher<{ messages: ChatMessage[] }>();
  const url = `/sessions/${card.sessionId}/messages`;
  const endRef = useRef<HTMLDivElement>(null);

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
    endRef.current?.scrollIntoView({ block: "end" });
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
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                    m.role === "user"
                      ? "self-end bg-primary text-primary-foreground"
                      : "self-start bg-muted",
                  )}
                >
                  {m.text}
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
          <Textarea
            autoFocus
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
                ? "Next message (⌘↵ to send)"
                : "This session is not in a cmux surface"
            }
            disabled={!card.drivable}
            className="min-h-32 flex-1 resize-y"
          />
          <Button disabled={!canSend} onClick={onSend} title="Send (⌘↵)">
            <SendHorizontal />
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
