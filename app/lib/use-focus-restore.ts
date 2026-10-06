import { useEffect } from "react";

const FOCUS_KEY = "seamux:focus";
// How long a reload waits for the remembered box to appear: drafts come back
// in effects of their own, and a reopened chat modal renders a little later.
const WAIT_MS = 2000;
// How long a box taken out from under the cursor waits for its new self: an
// open chat modal reopens a render after its card mounts.
const FOLLOW_MS = 1000;

type Remembered = { key: string; start: number | null; end: number | null };

function read(): Remembered | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(FOCUS_KEY);
  } catch {}
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Remembered;
  } catch {
    // Written by an older board: just the key.
    return { key: raw, start: null, end: null };
  }
}

function focusKeyOf(el: Element | null) {
  return el instanceof HTMLElement ? el.dataset.focusKey : undefined;
}

function isTextBox(
  el: Element | null,
): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

// Remembers which text box has focus and where its cursor is, so a reload
// (such as the board restarting after a landing) puts the cursor back where
// it was. Boxes opt in with a `data-focus-key` attribute. Switching to
// another app keeps the box as the active element, so it stays remembered;
// clicking elsewhere on the board forgets it.
export function useFocusRestore() {
  useEffect(() => {
    const remembered = read();
    let frame = 0;
    if (remembered) {
      const { key, start, end } = remembered;
      const deadline = Date.now() + WAIT_MS;
      const place = () => {
        const el = document.querySelector(
          `[data-focus-key="${CSS.escape(key)}"]`,
        );
        // Wait until the box exists and its draft is back in it.
        const ready = isTextBox(el) && (end === null || el.value.length >= end);
        if (!ready && Date.now() < deadline) {
          frame = requestAnimationFrame(place);
          return;
        }
        if (!isTextBox(el) || el.disabled) return;
        el.focus();
        const n = el.value.length;
        el.setSelectionRange(Math.min(start ?? n, n), Math.min(end ?? n, n));
      };
      frame = requestAnimationFrame(place);
    }

    const record = () => {
      const el = document.activeElement;
      const key = focusKeyOf(el);
      try {
        if (key) {
          const box = isTextBox(el) ? el : null;
          const next: Remembered = {
            key,
            start: box?.selectionStart ?? null,
            end: box?.selectionEnd ?? null,
          };
          sessionStorage.setItem(FOCUS_KEY, JSON.stringify(next));
        } else if (document.hasFocus()) {
          sessionStorage.removeItem(FOCUS_KEY);
        }
      } catch {}
    };
    // On focusout the next element isn't active yet; check once it is.
    const onFocusOut = () => setTimeout(record, 0);
    // The cursor moves without focus events, so take it as the page goes.
    const onPageHide = () => {
      if (focusKeyOf(document.activeElement)) record();
    };

    // A card that moves to another column mounts afresh, its chat modal with
    // it, and the box being typed in goes with the old one: follow the cursor
    // into the new box. Only a box taken out from under the cursor is
    // followed; one left by clicking elsewhere stays left.
    let typing: {
      box: HTMLInputElement | HTMLTextAreaElement;
      key: string;
    } | null = null;
    const track = () => {
      const el = document.activeElement;
      const key = focusKeyOf(el);
      if (key && isTextBox(el)) typing = { box: el, key };
      else if (document.hasFocus()) typing = null;
    };
    const onLeave = () =>
      setTimeout(() => {
        if (typing?.box.isConnected && document.activeElement !== typing.box)
          typing = null;
      }, 0);
    const follow = new MutationObserver(() => {
      if (!typing || typing.box.isConnected) return;
      const { box, key } = typing;
      typing = null;
      const deadline = Date.now() + FOLLOW_MS;
      const place = () => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const next = document.querySelector(
          `[data-focus-key="${CSS.escape(key)}"]`,
        );
        if (!isTextBox(next)) {
          if (Date.now() < deadline) frame = requestAnimationFrame(place);
          return;
        }
        if (next.disabled) return;
        next.focus({ preventScroll: true });
        const n = next.value.length;
        next.setSelectionRange(
          Math.min(box.selectionStart ?? n, n),
          Math.min(box.selectionEnd ?? n, n),
        );
      };
      place();
    });
    follow.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("focusin", record);
    document.addEventListener("focusin", track);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("focusout", onLeave);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelAnimationFrame(frame);
      follow.disconnect();
      document.removeEventListener("focusin", record);
      document.removeEventListener("focusin", track);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("focusout", onLeave);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}

// Called once a box's text is sent: the box lets go of focus, so a reload
// after sending doesn't land back in it. Sending empties the box, so text in
// it now was typed since, and the box keeps the cursor for the next message.
export function releaseFocus(key: string) {
  const el = document.activeElement;
  if (focusKeyOf(el) === key) {
    if (isTextBox(el) && el.value !== "") return;
    (el as HTMLElement).blur();
  }
  try {
    if (read()?.key === key) sessionStorage.removeItem(FOCUS_KEY);
  } catch {}
}
