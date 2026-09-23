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
}: {
  card: Card;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
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

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto border-y px-4 py-3">
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

        <div className="flex items-end gap-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="Next message (sending lands in phase 3)"
            className="min-h-32 flex-1 resize-y"
          />
          <Button disabled title="Send (phase 3)">
            <SendHorizontal />
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
