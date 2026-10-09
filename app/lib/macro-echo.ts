// A system macro seamux sent into a chat comes back in its transcript as a
// user prompt, at full length. The chat shows the macro's name in its place,
// and keeps only what the user typed themselves. A sent macro is recognised
// by its text against the macros as they are set now, so one edited since
// it was sent shows in full. Safe to import from scripts Node runs directly.

import {
  MACROS,
  usesVariable,
  type Config,
  type MacroName,
} from "./config.ts";

// Marks a macro's name where its text was.
export const MACRO_MARK = "✦";

export interface MacroEcho {
  // What the user typed into the dispatch bar, if the macro carried it.
  prompt: string;
  macros: MacroName[];
}

// The macro text as a pattern: each variable is anything, whitespace is any
// whitespace or none, since an empty variable leaves its spaces behind or
// trimmed away, and a variable named in `inner` is that pattern instead.
function pattern(text: string, inner: Record<string, string> = {}): string {
  const parts = text.trim().split(/(\{\{\s*\w+\s*\}\})/);
  // A regex names a group once, so a second {{prompt}} matches anything.
  let prompted = false;
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        const name = part.slice(2, -2).trim();
        if (Object.hasOwn(inner, name)) return inner[name];
        if (name !== "prompt" || prompted) return "[\\s\\S]*?";
        prompted = true;
        return "(?<prompt>[\\s\\S]*?)";
      }
      return part
        .split(/\s+/)
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s*");
    })
    .join("");
}

// What `text` is besides its variables: a macro made of nothing else adds
// nothing to collapse.
function literal(text: string): string {
  return text.replace(/\{\{\s*\w+\s*\}\}/g, "").trim();
}

let cached: { key: string; match: (text: string) => MacroEcho | null } | null =
  null;

function matcher(macros: Config["macros"]) {
  const key = JSON.stringify(macros);
  if (cached?.key === key) return cached.match;

  const close = macros.closeSession.text.trim();
  const closeRe = close ? new RegExp(`^${pattern(close)}$`) : null;

  // The new-session macro as firstPrompt (drive.server.ts) renders it: How
  // to worktree goes in its variable, or at the end when it has none.
  const howTo = macros.howToWorktree.text.trim();
  let newText = macros.newSession.text;
  if (howTo && !usesVariable(newText, "how_to_worktree"))
    newText += "\n\n{{how_to_worktree}}";
  const newRe = new RegExp(
    `^${pattern(newText, {
      how_to_worktree: howTo ? `(?<howTo>${pattern(howTo)})?` : "",
    })}$`,
  );
  const newLiteral = literal(macros.newSession.text) !== "";

  const match = (text: string): MacroEcho | null => {
    const trimmed = text.trim();
    if (closeRe?.test(trimmed)) return { prompt: "", macros: ["closeSession"] };
    const m = newRe.exec(trimmed);
    if (!m) return null;
    const found: MacroName[] = [];
    if (newLiteral) found.push("newSession");
    if (m.groups?.howTo) found.push("howToWorktree");
    if (!found.length) return null;
    return { prompt: (m.groups?.prompt ?? "").trim(), macros: found };
  };
  cached = { key, match };
  return match;
}

// The macros `text` was sent as, and the prompt inside them, or null for a
// prompt the user typed.
export function macroEcho(
  text: string,
  macros: Config["macros"],
): MacroEcho | null {
  return matcher(macros)(text);
}

// A macro's name as the chat shows it.
export function macroLabel(name: MacroName): string {
  return `${MACRO_MARK} ${MACROS[name].label} ${MACRO_MARK}`;
}

// A prompt as a card shows it: what the user typed, or the macro's name
// when that is all it was.
export function shownPrompt(text: string, macros: Config["macros"]): string {
  const echo = macroEcho(text, macros);
  if (!echo) return text;
  return echo.prompt || echo.macros.map(macroLabel).join(" ");
}
