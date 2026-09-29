import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "~/components/ui/button";

// Read by the inline script in root.tsx before first paint, so a chosen
// theme never flashes the OS one. Stored as JSON, like useLocalStorage.
export const THEME_KEY = "seamux:theme";

// The sun or moon beside the cog: flips the board between light and dark,
// and remembers the choice. Until one is made, or once it matches the OS
// again, the board follows the OS.
export function ThemeToggle() {
  // The class is set before hydration, so read it after mount.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    // Store the choice before flipping the class: root.tsx's script puts
    // the class back to match storage whenever it changes.
    try {
      // Flipping back to what the OS wants goes back to following it.
      if (next === matchMedia("(prefers-color-scheme: dark)").matches) {
        localStorage.removeItem(THEME_KEY);
      } else {
        localStorage.setItem(THEME_KEY, JSON.stringify(next ? "dark" : "light"));
      }
    } catch {}
    document.documentElement.classList.toggle("dark", next);
  };

  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      title={label}
      aria-label={label}
      onClick={toggle}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
