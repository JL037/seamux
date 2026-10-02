import { useCallback, useEffect, useRef } from "react";

// Calls `fn` at most once every `ms`: a call after a quiet spell goes at
// once, and the last call in each window goes as the window ends, so nothing
// waits for the calls to stop. A call still waiting is sent on unmount and on
// pagehide; `cancel` drops it instead.
export function useThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<A | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    waiting.current = null;
  }, []);

  const flush = useCallback(() => {
    const args = waiting.current;
    cancel();
    if (!args) return;
    last.current = Date.now();
    fnRef.current(...args);
  }, [cancel]);

  const call = useCallback(
    (...args: A) => {
      waiting.current = args;
      const wait = last.current + ms - Date.now();
      if (wait <= 0) flush();
      else if (!timer.current) timer.current = setTimeout(flush, wait);
    },
    [ms, flush],
  );

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return { call, cancel };
}
