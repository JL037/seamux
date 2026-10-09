// Reading transcripts, whichever agent wrote them: the tail of a file, and
// text cut down for a card.

import { open } from "node:fs/promises";

import type { ChatMessage } from "./board.ts";
import type { Config } from "./config.ts";
import { macroEcho, shownPrompt } from "./macro-echo.ts";

const TAIL_BYTES = 2 * 1024 * 1024;
const EXCERPT_CHARS = 280;
// A card renders its last reply as markdown, clipped to a few lines.
const REPLY_EXCERPT_CHARS = 800;

export async function readTail(path: string): Promise<string[]> {
  const file = await open(path);
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await file.read(buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    // The first line is partial unless we read from the start.
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    await file.close();
  }
}

// Claude Code wraps text pasted into a prompt in
// <pasted_content id="N">…</pasted_content id="N"> for the model. The user sees
// the paste, not the tags.
export function unwrapPasted(text: string): string {
  return text
    .replace(/<\/?pasted_content(?:\s+id="[^"]*")?>\n?/g, "")
    .trim();
}

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS
    ? `${flat.slice(0, EXCERPT_CHARS - 1)}…`
    : flat;
}

// The end of a reply, where it says what was done or asks what's next, with
// the line breaks its markdown is built on. It starts at a line, and reopens
// a code block it starts inside.
export function replyExcerpt(text: string): string {
  const kept = text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (kept.length <= REPLY_EXCERPT_CHARS) return kept;
  let tail = kept.slice(-REPLY_EXCERPT_CHARS);
  const line = tail.indexOf("\n");
  if (line >= 0 && line < tail.length - 1) tail = tail.slice(line + 1);
  const fences = (tail.match(/^\s*```/gm) ?? []).length;
  return fences % 2 ? `\`\`\`\n${tail}` : tail;
}

// The last paragraph of a reply that ends on a question, so the chat is
// waiting on the user although no dialog is open. The question need not be
// its last sentence: "Want me to go ahead? Or tell me to stop." still asks.
// Trailing markdown such as bold or a closing quote does not hide the
// question mark, and one inside a URL or code does not count.
export function endingQuestionIn(text: string | null): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const last = trimmed.split(/\n\s*\n/).at(-1) ?? trimmed;
  const prose = last.replace(/`[^`]*`/g, "");
  if (!/\?[*_`"')\]]*(?:\s|$)/.test(prose)) return null;
  return excerpt(last.replace(/\*\*|__|`/g, ""));
}

// Messages are cut to this in the chat view.
export const MESSAGE_CHARS = 20_000;

export function clip(text: string): string {
  return text.length > MESSAGE_CHARS
    ? `${text.slice(0, MESSAGE_CHARS)}…`
    : text;
}

// A prompt as a card shows it, a macro seamux sent by its name.
export function promptExcerpt(text: string, macros: Config["macros"]): string {
  return excerpt(shownPrompt(text, macros));
}

// A prompt as the chat shows it: what the user typed, with the name of each
// macro seamux sent it in where the macro's text was.
export function userTurn(
  text: string,
  at: string | null,
  macros: Config["macros"],
): ChatMessage[] {
  const echo = macroEcho(text, macros);
  if (!echo) return [{ role: "user", text: clip(text), at }];
  const turn: ChatMessage[] = echo.macros.map((name) => ({
    role: "macro",
    name,
    at,
  }));
  if (echo.prompt)
    turn.splice(echo.promptAt, 0, { role: "user", text: clip(echo.prompt), at });
  return turn;
}
