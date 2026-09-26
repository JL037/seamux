// seamux's own settings, set from the board's config dialog. Safe to import
// from client and server, and from scripts Node runs directly.

// System macros: text the dispatcher sends into a session as a user prompt,
// at a fixed point in its life.
export const MACRO_NAMES = [
  "newSession",
  "howToWorktree",
  "closeSession",
] as const;
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
      {
        name: "how_to_worktree",
        meaning:
          "the How to worktree macro, when it applies; added at the end if left out",
      },
    ],
    required: "prompt",
  },
  howToWorktree: {
    label: "How to worktree",
    when: "Filled into the new session's {{how_to_worktree}} when seamux starts it in a new worktree in a repo with no worktree convention: one that neither has .claude/worktrees nor ignores worktrees/. That worktree goes under worktrees/. Leave it empty to say nothing.",
    variables: [
      { name: "worktree", meaning: "the new worktree's directory" },
      { name: "branch", meaning: "its branch" },
      { name: "repo", meaning: "the repo's main checkout, which holds it" },
    ],
    required: null,
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
  newSession: "{{prompt}}\n\n{{how_to_worktree}}",
  howToWorktree: `## How to worktree

You are working in a new git worktree, {{worktree}}, on branch {{branch}}. This repo has no worktree convention yet, so its worktrees go under worktrees/ in its main checkout, {{repo}}, which git should ignore. Worktrees never go inside other worktrees.

1. Before anything else, check that the repo ignores worktrees/: \`git -C {{repo}} check-ignore -q worktrees/\` succeeds when it does. If it doesn't, add \`/worktrees/\` to .gitignore and commit that first, so the change lands with your work.
2. Install the project's dependencies in this worktree before running any of its scripts. Package managers hoist dependencies inconsistently, so what is installed in {{repo}} may not resolve from here.
3. Do all your work in this worktree, never in {{repo}}.`,
  closeSession: `Clean up after yourself: if you are working in a worktree, remove it and its branch.

{{siblings}} Do not touch anything outside your own worktree, and do not run a bare \`git worktree prune\` or anything else that operates on the whole repo.

If you have uncommitted work, say so and stop rather than discarding it.`,
};

export const MAX_MACRO = 20_000;

// The agents seamux can launch and drive, each through its cmux wrapper.
// cmux integrates more (`cmux hooks setup` lists them), but only these have
// been measured end to end; docs/findings.md has what each one does.
export const ENGINES = ["claude", "codex"] as const;
export type Engine = (typeof ENGINES)[number];

export const ENGINE_LABELS: Record<Engine, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

// Each service's own color, for what the board shows about it: Anthropic's
// clay for Claude Code, OpenAI's teal for Codex.
export const ENGINE_COLORS: Record<Engine, string> = {
  claude: "#d97757",
  codex: "#4ba281",
};

export function isEngine(name: string): name is Engine {
  return (ENGINES as readonly string[]).includes(name);
}

export interface Config {
  // What the dispatch bar's directory picker offers. Empty means every
  // directory seamux can find.
  directories: string[];
  // The dispatch bar's "new worktree" switch starts on.
  worktreeByDefault: boolean;
  // What the dispatch bar launches unless it is switched for one dispatch.
  defaultEngine: Engine;
  macros: Record<MacroName, { text: string; custom: boolean }>;
}

export const DEFAULT_CONFIG: Config = {
  directories: [],
  worktreeByDefault: false,
  defaultEngine: "claude",
  macros: Object.fromEntries(
    MACRO_NAMES.map((name) => [
      name,
      { text: DEFAULT_MACROS[name], custom: false },
    ]),
  ) as Config["macros"],
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
