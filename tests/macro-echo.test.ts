// Recognising a macro seamux sent when it comes back as a prompt
// (app/lib/macro-echo.ts), so the chat shows its name instead of its text.

import { expect, it } from "vitest";

import { DEFAULT_CONFIG, renderMacro, type Config } from "~/lib/config";
import { macroEcho, shownPrompt } from "~/lib/macro-echo";

const macros = DEFAULT_CONFIG.macros;

const howTo = renderMacro(macros.howToWorktree.text, {
  worktree: "/work/repo/.claude/worktrees/fix-it",
  branch: "worktree-fix-it",
  repo: "/work/repo",
  worktrees: ".claude/worktrees/",
}).trim();

function custom(changes: Partial<Record<keyof Config["macros"], string>>) {
  const out = { ...macros };
  for (const [name, text] of Object.entries(changes))
    out[name as keyof Config["macros"]] = { text, custom: true };
  return out;
}

it("keeps the prompt of a new session and names How to worktree", () => {
  // As the user typed it in the dispatch bar, with Windows line ends.
  const prompt = "Fix the thing\r\n\r\nand the other";
  const sent = renderMacro(macros.newSession.text, {
    prompt,
    cwd: "/work/repo",
    how_to_worktree: howTo,
  }).trim();
  expect(macroEcho(sent, macros)).toEqual({
    prompt,
    macros: ["howToWorktree"],
  });
  expect(shownPrompt(sent, macros)).toBe(prompt);
});

it("leaves a prompt that carries no macro text alone", () => {
  // A new session without a worktree is only what was typed.
  expect(macroEcho("Fix the thing", macros)).toBeNull();
  expect(macroEcho("## How to worktree\n\nmy own notes", macros)).toBeNull();
  expect(shownPrompt("Fix the thing", macros)).toBe("Fix the thing");
});

it("names the close-session macro, with or without siblings", () => {
  for (const siblings of [
    "There are 2 other sessions live under /work/repo right now: A and B.",
    "",
  ]) {
    const sent = renderMacro(macros.closeSession.text.trim(), {
      cwd: "/work/repo",
      repo: "/work/repo",
      siblings,
    });
    expect(macroEcho(sent, macros)).toEqual({
      prompt: "",
      macros: ["closeSession"],
    });
    expect(shownPrompt(sent, macros)).toBe("✦ Close session ✦");
  }
});

it("follows macros as they are set", () => {
  const set = custom({
    newSession: "Work on this: {{prompt}}",
    closeSession: "Wrap up in {{cwd}}.",
  });
  // A new-session macro without {{how_to_worktree}} gets it at the end.
  expect(
    macroEcho(`Work on this: the bug\n\n${howTo}`, set),
  ).toEqual({ prompt: "the bug", macros: ["newSession", "howToWorktree"] });
  expect(macroEcho("Work on this: the bug", set)).toEqual({
    prompt: "the bug",
    macros: ["newSession"],
  });
  expect(macroEcho("Wrap up in /work/repo.", set)).toEqual({
    prompt: "",
    macros: ["closeSession"],
  });
  // The default text, once changed, is the user's own.
  expect(macroEcho(renderMacro(macros.closeSession.text, {}), set)).toBeNull();
});

it("never matches an emptied close-session macro", () => {
  expect(macroEcho("anything", custom({ closeSession: "" }))).toBeNull();
});
