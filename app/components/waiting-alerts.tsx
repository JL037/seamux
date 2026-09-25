import { useEffect, useRef, useState } from "react";

import { ASKED_IN_REPLY, type Card } from "~/lib/board";
import { useLocalStorage } from "~/lib/use-session-storage";

// Cards blocked on Jakob, pinned or not.
export function waitingCards(cards: Card[]): Card[] {
  return cards.filter((c) => c.column === "waiting");
}

// The tab title: "(2) seamux" while two chats wait.
export function titleWithCount(name: string, waiting: number): string {
  return waiting > 0 ? `(${waiting}) ${name}` : name;
}

type Permission = NotificationPermission | "unsupported";

// Browsers only offer notifications in a secure context, which localhost
// and the tunnel are and the plain-HTTP `.local` address is not.
function currentPermission(): Permission {
  if (typeof window === "undefined" || !("Notification" in window))
    return "unsupported";
  return Notification.permission;
}

// Desktop notifications for chats that start waiting, kept per browser.
// Only a card that newly enters WAITING notifies, and only while the board
// isn't the focused window, since there the card is already in view.
export function useWaitingNotifications(cards: Card[]) {
  const [enabled, setEnabled] = useLocalStorage("seamux:notify", false);
  const [permission, setPermission] = useState<Permission>("unsupported");
  useEffect(() => setPermission(currentPermission()), []);
  const active = enabled && permission === "granted";

  // null until the first board is seen, so opening the tab doesn't announce
  // everything already waiting.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const waiting = waitingCards(cards);
    const before = seen.current;
    seen.current = new Set(waiting.map((c) => c.sessionId));
    if (!before || !active || document.hasFocus()) return;
    for (const card of waiting) {
      if (before.has(card.sessionId)) continue;
      try {
        const n = new Notification(card.name, {
          body: describe(card),
          tag: `seamux:${card.sessionId}`,
          icon: "/favicon.svg",
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {}
    }
  }, [cards, active]);

  const toggle = async () => {
    if (enabled) return setEnabled(false);
    let p = currentPermission();
    if (p === "default") p = await Notification.requestPermission();
    setPermission(p);
    if (p === "granted") setEnabled(true);
  };

  return { enabled: active, permission, toggle };
}

// One line on what the card waits on, as its panel words it.
function describe(card: Card): string {
  const w = card.waiting;
  if (!w) return "Waiting";
  if (w.ask) return w.ask.questions[0]?.question ?? "Has a question";
  if (w.reason === ASKED_IN_REPLY) return `Asked: ${w.detail ?? ""}`.trim();
  const head =
    w.reason === "permission prompt"
      ? "Needs approval"
      : (w.dialog?.title ?? `Waiting: ${w.reason ?? "input"}`);
  const tool = w.tool ? ` · ${w.tool}` : "";
  return w.detail ? `${head}${tool}\n${w.detail}` : `${head}${tool}`;
}

export type Notifications = ReturnType<typeof useWaitingNotifications>;
