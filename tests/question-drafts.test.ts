import { describe, expect, it } from "vitest";

import type { Question } from "~/lib/board";
import { answerOf, type QuestionDraft } from "~/lib/question-drafts";

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

const draft = (d: Partial<QuestionDraft>): QuestionDraft => ({
  picks: [],
  text: "",
  notes: null,
  ...d,
});

describe("answerOf", () => {
  it("answers with the picks", () => {
    expect(answerOf(question(true), draft({ picks: [0, 1] }))).toEqual({
      picks: [0, 1],
    });
  });

  it("answers a single-select question with the text typed", () => {
    expect(answerOf(question(false), draft({ text: " mine " }))).toEqual({
      text: "mine",
    });
  });

  it("takes no text on a multi-select question or one with previews", () => {
    expect(answerOf(question(true), draft({ text: "mine" }))).toBeNull();
    expect(answerOf(question(false, "x"), draft({ text: "mine" }))).toBeNull();
  });

  it("sends a note with a pick", () => {
    expect(
      answerOf(question(false, "x"), draft({ picks: [0], notes: " why " })),
    ).toEqual({ picks: [0], notes: "why" });
  });

  it("has no answer before a pick or any text", () => {
    expect(answerOf(question(false), draft({ text: "  " }))).toBeNull();
  });
});
