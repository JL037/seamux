import { useCallback, useEffect, useRef, useState } from "react";

// State mirrored into sessionStorage, so what's typed survives a reload,
// such as the board restarting after a landing. The stored value is read
// after mount, keeping the server render and hydration in step; until then
// the state is `initial`. Setting `initial` again removes the key.
export function useSessionStorage<T>(key: string, initial: T) {
  return useStoredState("session", key, initial);
}

// The same, in localStorage, for preferences that should outlive the tab.
export function useLocalStorage<T>(key: string, initial: T) {
  return useStoredState("local", key, initial);
}

function useStoredState<T>(
  area: "session" | "local",
  key: string,
  initial: T,
) {
  const [value, setValue] = useState<T>(initial);
  const initialRef = useRef(initial);

  useEffect(() => {
    try {
      const raw = storage(area).getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {}
  }, [area, key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v =
          typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        try {
          if (JSON.stringify(v) === JSON.stringify(initialRef.current)) {
            storage(area).removeItem(key);
          } else {
            storage(area).setItem(key, JSON.stringify(v));
          }
        } catch {}
        return v;
      });
    },
    [area, key],
  );

  return [value, set] as const;
}

function storage(area: "session" | "local"): Storage {
  return area === "session" ? sessionStorage : localStorage;
}
