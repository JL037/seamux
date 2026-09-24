import { useEffect } from "react";

const FOCUS_KEY = "seemux:focus";
// How long a reload waits for the remembered box to appear: drafts come back
// in effects of their own, and a reopened chat modal renders a little later.
const WAIT_MS = 2000;

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
        const ready =
          isTextBox(el) && (end === null || el.value.length >= end);
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

    document.addEventListener("focusin", record);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", record);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}

// Called once a box's text is sent: the box lets go of focus, so a reload
// after sending doesn't land back in it.
export function releaseFocus(key: string) {
  if (focusKeyOf(document.activeElement) === key) {
    (document.activeElement as HTMLElement).blur();
  }
  try {
    if (read()?.key === key) sessionStorage.removeItem(FOCUS_KEY);
  } catch {}
}
