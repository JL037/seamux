import { describe, expect, it } from "vitest";

import type { Question } from "~/lib/board";
import { textAnswers, type QuestionDraft } from "~/lib/question-drafts";

const question = (multiSelect: boolean, preview: string | null = null) =>
  ({
    question: "Which one?",
    header: "Pick",
    multiSelect,
    options: [
      { label: "A", description: null, preview },
      { label: "B", description: null, preview: null },
    ],
  }) satisfies Question;

const none: QuestionDraft = { picks: [], notes: null };
const picked = (...picks: number[]): QuestionDraft => ({ picks, notes: null });

describe("textAnswers", () => {
  it("answers a lone question with the reply's text", () => {
    expect(textAnswers([question(false)], [none], " mine ")).toEqual([
      { text: "mine" },
    ]);
  });

  it("puts the text in place of a lone question's pick", () => {
    expect(textAnswers([question(false)], [picked(1)], "mine")).toEqual([
      { text: "mine" },
    ]);
  });

  it("answers the one question left without a pick, the rest with theirs", () => {
    expect(
      textAnswers(
        [question(true), question(false)],
        [picked(0, 1), none],
        "mine",
      ),
    ).toEqual([{ picks: [0, 1] }, { text: "mine" }]);
  });

  it("can't tell which of several open questions the text answers", () => {
    expect(
      textAnswers([question(false), question(false)], [none, none], "mine"),
    ).toBeNull();
  });

  it("has no text for a multi-select question or one with previews", () => {
    expect(textAnswers([question(true)], [none], "mine")).toBeNull();
    expect(textAnswers([question(false, "x")], [none], "mine")).toBeNull();
  });

  it("sends nothing without text", () => {
    expect(textAnswers([question(false)], [none], "  ")).toBeNull();
  });
});
