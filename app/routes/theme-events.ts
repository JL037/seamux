import type { Route } from "./+types/theme-events";
import { assertLocalRead } from "~/lib/guard.server";
import {
  onThemeChange,
  themeEvent,
  type ThemeEvent,
} from "~/lib/theme.server";

// The board's theme as it changes, as server-sent events, so a board
// switches as soon as a theme is set rather than at its next poll. Each
// event is a ThemeEvent: the active theme and the hash of the themes' CSS.
// The first is sent as it connects; a comment every 20 seconds keeps
// proxies from closing it as idle.

const KEEPALIVE_MS = 20_000;

export function loader({ request }: Route.LoaderArgs) {
  assertLocalRead(request);
  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const send = (event: ThemeEvent) =>
        write(`data: ${JSON.stringify(event)}\n\n`);
      send(themeEvent());
      const unsubscribe = onThemeChange(send);
      const keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_MS);
      stop = () => {
        unsubscribe();
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
