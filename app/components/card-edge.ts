import type { Column } from "~/lib/board";
import type { Engine } from "~/lib/config";

// The frame a card and its open chat share: a hairline along the top edge
// (::before, colored by EDGE) running into the engine's top-right corner
// (::after, colored by ENGINE_CORNER), whose right side runs on down and
// fades out. The element must be positioned: relative on a card, fixed on
// the dialog.
export const EDGE_FRAME =
  "before:absolute before:inset-x-0 before:top-0 before:h-0.5 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-5 after:rounded-tr-xl after:border-t-2 after:border-r-2 after:border-(--corner) after:mask-corner-fade";

// The top edge: the ramp for a working chat, a fade in from nothing for one
// idle or waiting.
export const EDGE: Partial<Record<Column, string>> = {
  idle: "before:bg-edge-fade",
  waiting: "before:bg-edge-fade",
  working: "before:bg-edge-working",
};

// Which agent runs the chat, as its top-right corner: Anthropic's orange for
// Claude Code, OpenAI's teal for Codex.
export const ENGINE_CORNER: Record<Engine, string> = {
  claude: "[--corner:#d97757]",
  codex: "[--corner:#4ba281]",
};
