import { useEffect, useState } from "react";

// The server renders the board whether or not its scripts then run in the
// browser, and when they don't, every button is dead and nothing says so. This
// link is in the server's HTML, hidden until a CSS animation shows it after a
// while, and React takes it away as soon as it hydrates: it only ever shows on
// a page whose scripts never started. Styled inline, since the stylesheet may
// be as stale as the scripts.
export function StuckBoard() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (hydrated) return null;
  return (
    <>
      <style>{`@keyframes seamux-stuck{to{visibility:visible}}`}</style>
      <a
        href="/restart"
        style={{
          visibility: "hidden",
          animation: "seamux-stuck 0s 10s forwards",
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: "calc(1rem + env(safe-area-inset-bottom))",
          zIndex: 2147483647,
          padding: "0.6rem 1rem",
          borderRadius: "0.5rem",
          border: "1px solid currentColor",
          background: "Canvas",
          color: "CanvasText",
          font: "15px system-ui, sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        Buttons not working? Restart the board
      </a>
    </>
  );
}
