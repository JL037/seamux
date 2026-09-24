import { useCallback, useEffect, useRef, useState } from "react";

// State mirrored into sessionStorage, so what's typed survives a reload,
// such as the board restarting after a landing. The stored value is read
// after mount, keeping the server render and hydration in step; until then
// the state is `initial`. Setting `initial` again removes the key.
export function useSessionStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const initialRef = useRef(initial);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {}
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v =
          typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        try {
          if (JSON.stringify(v) === JSON.stringify(initialRef.current)) {
            sessionStorage.removeItem(key);
          } else {
            sessionStorage.setItem(key, JSON.stringify(v));
          }
        } catch {}
        return v;
      });
    },
    [key],
  );

  return [value, set] as const;
}
