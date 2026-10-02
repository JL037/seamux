import { useCallback, useEffect, useRef } from "react";

// Calls `fn` once calls have stopped for `ms`, with the last call's
// arguments. A call still waiting is sent on unmount and on pagehide, which,
// unlike beforeunload, fires on a phone too; `cancel` drops it instead.
export function useDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
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
    if (args) fnRef.current(...args);
  }, [cancel]);

  const call = useCallback(
    (...args: A) => {
      waiting.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, ms);
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
