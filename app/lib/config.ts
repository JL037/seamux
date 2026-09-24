// seamux's own settings, set from the board's config dialog. Safe to import
// from client and server, and from scripts Node runs directly.

// System macros: text the dispatcher sends into a session as a user prompt,
// at a fixed point in its life.
export const MACRO_NAMES = ["newSession", "closeSession"] as const;
export type MacroName = (typeof MACRO_NAMES)[number];

export interface MacroInfo {
  label: string;
  // When the dispatcher sends it.
  when: string;
  variables: { name: string; meaning: string }[];
  // A variable the macro must contain, if any.
  required: string | null;
}

export const MACROS: Record<MacroName, MacroInfo> = {
  newSession: {
    label: "New session",
    when: "The first prompt of every session seamux dispatches, from the board or a fan-out.",
    variables: [
      { name: "prompt", meaning: "what you typed into the dispatch bar" },
      { name: "cwd", meaning: "the directory the session starts in" },
    ],
    required: "prompt",
  },
  closeSession: {
    label: "Close session",
    when: "Sent when you close an idle chat. The chat exits once that turn ends, unless it leaves uncommitted changes or its worktree behind. Leave it empty to exit straight away.",
    variables: [
      { name: "cwd", meaning: "the session's directory" },
      { name: "repo", meaning: "the repo it belongs to, worktrees included" },
      {
        name: "siblings",
        meaning: "a sentence naming the other live sessions under that repo",
      },
    ],
    required: null,
  },
};

export const DEFAULT_MACROS: Record<MacroName, string> = {
  newSession: "{{prompt}}",
  closeSession: `Clean up after yourself: if you are working in a worktree, remove it and its branch.

{{siblings}} Do not touch anything outside your own worktree, and do not run a bare \`git worktree prune\` or anything else that operates on the whole repo.

If you have uncommitted work, say so and stop rather than discarding it.`,
};

export const MAX_MACRO = 20_000;

export interface Config {
  // What the dispatch bar's directory picker offers. Empty means every
  // directory seamux can find.
  directories: string[];
  // The dispatch bar's "new worktree" box starts ticked.
  worktreeByDefault: boolean;
  macros: Record<MacroName, { text: string; custom: boolean }>;
}

export const DEFAULT_CONFIG: Config = {
  directories: [],
  worktreeByDefault: false,
  macros: {
    newSession: { text: DEFAULT_MACROS.newSession, custom: false },
    closeSession: { text: DEFAULT_MACROS.closeSession, custom: false },
  },
};

// Fills `{{name}}` from `vars` in one pass, so a value that itself contains
// braces is left alone. An unknown name is kept as written.
export function renderMacro(
  text: string,
  vars: Record<string, string>,
): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? vars[name] : whole,
  );
}

export function usesVariable(text: string, name: string): boolean {
  return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(text);
}
