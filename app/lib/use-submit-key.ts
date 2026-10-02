import { useEffect, useState } from "react";

// The hint for the send shortcut: ⌘↵ on Apple devices, Ctrl+↵ everywhere
// else. Text boxes accept either key; this only picks the label. ⌘↵ until
// mounted, like the server render.
export function useSubmitKey(): string {
  const [key, setKey] = useState("⌘↵");
  useEffect(() => {
    const nav = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const platform = nav.userAgentData?.platform || nav.platform || "";
    if (!/mac|iphone|ipad|ipod/i.test(platform)) setKey("Ctrl+↵");
  }, []);
  return key;
}
