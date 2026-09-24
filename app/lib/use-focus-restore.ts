import { useEffect } from "react";

const FOCUS_KEY = "seemux:focus";

// Remembers which text box has focus, so a reload (such as the board
// restarting after a landing) puts the cursor back where it was, at the end
// of the text. Boxes opt in with a `data-focus-key` attribute. Switching to
// another app keeps the box as the active element, so it stays remembered;
// clicking elsewhere on the board forgets it.
export function useFocusRestore() {
  useEffect(() => {
    let key: string | null = null;
    try {
      key = sessionStorage.getItem(FOCUS_KEY);
    } catch {}

    // Drafts are restored by effects of their own, so wait a frame for them
    // to render before placing the cursor after the text.
    const frame = key
      ? requestAnimationFrame(() => {
          const el = document.querySelector<
            HTMLInputElement | HTMLTextAreaElement
          >(`[data-focus-key="${CSS.escape(key)}"]`);
          if (!el || el.disabled) return;
          el.focus();
          const end = el.value.length;
          el.setSelectionRange(end, end);
        })
      : 0;

    const record = () => {
      const el = document.activeElement;
      const next = el instanceof HTMLElement ? el.dataset.focusKey : undefined;
      try {
        if (next) sessionStorage.setItem(FOCUS_KEY, next);
        else if (document.hasFocus()) sessionStorage.removeItem(FOCUS_KEY);
      } catch {}
    };
    // On focusout the next element isn't active yet; check once it is.
    const onFocusOut = () => setTimeout(record, 0);

    document.addEventListener("focusin", record);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", record);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);
}

// Called once a box's text is sent: the box lets go of focus, so a reload
// after sending doesn't land back in it.
export function releaseFocus(key: string) {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.dataset.focusKey === key) el.blur();
  try {
    if (sessionStorage.getItem(FOCUS_KEY) === key) {
      sessionStorage.removeItem(FOCUS_KEY);
    }
  } catch {}
}
