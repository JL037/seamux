import { useLocalStorage } from "~/lib/use-session-storage";

// Kept in this browser, like diagnostics: it is this screen being shown.
// root.tsx sets the attribute before the first paint; this keeps it in step
// once the switch is flipped.
export const BLUR_KEY = "seamux:blur";

export function useBlur() {
  const [enabled, setEnabled] = useLocalStorage(BLUR_KEY, false);
  return {
    enabled,
    setEnabled: (on: boolean) => {
      setEnabled(on);
      document.documentElement.toggleAttribute("data-blur", on);
    },
  };
}

export type Blur = ReturnType<typeof useBlur>;
