import { useEffect, useState } from "react";

// Whether the main pointer is a finger. Drag and drop, double-click and
// autofocus assume a mouse; on a phone they either don't fire or pop the
// keyboard over what should be read first. False until mounted, like the
// server render.
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return coarse;
}
