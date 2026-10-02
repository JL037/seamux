import { useEffect, useState } from "react";
import { useCoarsePointer } from "~/lib/use-pointer";

// The hint for the send shortcut: ⌘↵ on Apple devices, Ctrl+↵ everywhere
// else, and none on a touch screen, whose keyboard has no shortcut to send.
// Text boxes accept either key; this only picks the label. ⌘↵ until
// mounted, like the server render.
export function useSubmitKey(): string | null {
  const coarse = useCoarsePointer();
  const [key, setKey] = useState("⌘↵");
  useEffect(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const platform = nav.userAgentData?.platform || nav.platform || "";
    if (!/mac|iphone|ipad|ipod/i.test(platform)) setKey("Ctrl+↵");
  }, []);
  return coarse ? null : key;
}

// The shortcut in parentheses, with what it does, or nothing when there's
// no shortcut to show.
export function keyHint(key: string | null, what = ""): string {
  return key ? ` (${key}${what})` : "";
}
