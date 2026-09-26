import { useCallback, useEffect, useRef, useState } from "react";

import { collectDiagnostics, type Snapshot } from "~/lib/diagnostics";
import { useLocalStorage } from "~/lib/use-session-storage";

export type Sent = {
  at: string;
  error: string | null;
  snapshot: Snapshot;
};

// While the Debug tab's switch is on in this browser, a snapshot goes to
// the server when the board loads, a second after the window is resized or
// turned, and whenever one is asked for.
export function useDiagnostics(boardHash: string | undefined) {
  const [enabled, setEnabled] = useLocalStorage("seamux:diagnostics", false);
  const [last, setLast] = useState<Sent | null>(null);
  // The version this page's code was loaded at, beside the one the board
  // now serves: they differ on a page left running across a landing.
  const loaded = useRef(boardHash);
  const board = useRef(boardHash);
  board.current = boardHash;

  const send = useCallback(async (reason: string) => {
    const snapshot = await collectDiagnostics(reason, {
      loaded: loaded.current,
      board: board.current,
    });
    let error: string | null = null;
    try {
      const res = await fetch("/diagnostics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) error = `${res.status} ${await res.text()}`.trim();
    } catch (e) {
      error = (e as Error).message;
    }
    setLast({ at: new Date().toLocaleTimeString(), error, snapshot });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Once the columns have laid out and the carousel has found its place.
    const first = setTimeout(() => send("load"), 1500);
    let later: ReturnType<typeof setTimeout> | undefined;
    const resized = () => {
      clearTimeout(later);
      later = setTimeout(() => send("resize"), 1000);
    };
    window.addEventListener("resize", resized);
    screen.orientation?.addEventListener?.("change", resized);
    return () => {
      clearTimeout(first);
      clearTimeout(later);
      window.removeEventListener("resize", resized);
      screen.orientation?.removeEventListener?.("change", resized);
    };
  }, [enabled, send]);

  return {
    enabled,
    setEnabled,
    send: () => send("manual"),
    last,
  };
}

export type Diagnostics = ReturnType<typeof useDiagnostics>;
