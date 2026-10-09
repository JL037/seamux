// A system macro seamux sent into a chat comes back in its transcript as a
// user prompt, at full length. The chat shows the macro's name in its place,
// and keeps only what the user typed themselves. A sent macro is recognised
// by its text against the macros as they are set now, so one edited since
// it was sent shows in full. Safe to import from scripts Node runs directly.

import {
  MACROS,
  newSessionTemplate,
  type Config,
  type MacroName,
} from "./config.ts";

// Marks a macro's name where its text was.
export const MACRO_MARK = "✦";

export interface MacroEcho {
  // What the user typed into the dispatch bar, if the macro carried it.
  prompt: string;
  // In the order the message holds them.
  macros: MacroName[];
  // Where the prompt sat among them.
  promptAt: number;
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

// The macros the New session macro fills in, by variable, each matched in
// a group of its own.
const INNER = {
  session_information: { group: "info", macro: "sessionInformation" },
  how_to_worktree: { group: "howTo", macro: "howToWorktree" },
} as const satisfies Record<string, { group: string; macro: MacroName }>;
type Inner = keyof typeof INNER;

// One shape a message seamux sent can take: a template of the macros above
// and {{prompt}}, and whether it is the New session macro's own.
interface Form {
  re: RegExp;
  order: (Inner | "prompt")[];
  wrapper: boolean;
}

function form(
  template: string,
  macros: Config["macros"],
  wrapper: boolean,
): Form {
  const inner: Record<string, string> = {};
  for (const [name, { group, macro }] of Object.entries(INNER)) {
    const text = macros[macro].text.trim();
    inner[name] = literal(text) ? `(?<${group}>${pattern(text)})?` : "";
  }
  const order = new Set<Inner | "prompt">();
  for (const [, name] of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g))
    if (name === "prompt" || Object.hasOwn(INNER, name))
      order.add(name as Inner | "prompt");
  return {
    re: new RegExp(`^${pattern(template, inner)}$`),
    order: [...order],
    wrapper,
  };
}

// The New session macro as seamux's defaults had it before Session
// information, so a chat dispatched then still reads the same.
const EARLIER_NEW_SESSION = "{{prompt}}\n\n{{how_to_worktree}}";

let cached: { key: string; match: (text: string) => MacroEcho | null } | null =
  null;

function matcher(macros: Config["macros"]) {
  const key = JSON.stringify(macros);
  if (cached?.key === key) return cached.match;

  const close = macros.closeSession.text.trim();
  const closeRe = close ? new RegExp(`^${pattern(close)}$`) : null;

  // A first prompt as firstPrompt (drive.server.ts) renders it, the macros
  // sent again after a /clear, and a first prompt from before.
  const forms = [
    form(
      newSessionTemplate(macros.newSession.text),
      macros,
      literal(macros.newSession.text) !== "",
    ),
    form("{{session_information}}\n\n{{how_to_worktree}}", macros, false),
    form(EARLIER_NEW_SESSION, macros, false),
  ];

  const match = (text: string): MacroEcho | null => {
    const trimmed = text.trim();
    if (closeRe?.test(trimmed))
      return { prompt: "", macros: ["closeSession"], promptAt: 1 };
    for (const f of forms) {
      const groups = f.re.exec(trimmed)?.groups;
      if (!groups) continue;
      const found: MacroName[] = [];
      let promptAt = 0;
      for (const name of f.order) {
        if (name === "prompt") {
          if (f.wrapper) found.push("newSession");
          promptAt = found.length;
        } else if (groups[INNER[name].group]) found.push(INNER[name].macro);
      }
      if (!f.order.includes("prompt")) promptAt = found.length;
      if (found.length)
        return { prompt: (groups.prompt ?? "").trim(), macros: found, promptAt };
    }
    return null;
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
