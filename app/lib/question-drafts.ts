import { useCallback, useSyncExternalStore } from "react";

import { hasPreviews, type Answer, type Question } from "~/lib/board";

// The picks made so far on an open AskUserQuestion, one per question. Kept
// by tool call rather than in the form, so the card's form and the chat
// modal's show the same answers.
export interface QuestionDraft {
  picks: number[];
  // An answer of the user's own, in place of the picks.
  text: string;
  // null until "Add a note" opens the box.
  notes: string | null;
}

const drafts = new Map<string, QuestionDraft[]>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: QuestionDraft = { picks: [], text: "", notes: null };
const blank = (n: number) => Array.from({ length: n }, () => EMPTY);

export function useQuestionDrafts(toolUseId: string, count: number) {
  const current = useSyncExternalStore(
    subscribe,
    () => drafts.get(toolUseId),
    () => undefined,
  );
  const update = useCallback(
    (i: number, d: QuestionDraft) => {
      const all = drafts.get(toolUseId) ?? blank(count);
      drafts.set(
        toolUseId,
        all.map((x, j) => (j === i ? d : x)),
      );
      for (const l of listeners) l();
    },
    [toolUseId, count],
  );
  return [current ?? blank(count), update] as const;
}

// A question that takes an answer of the user's own: only a single-select
// one without previews has Claude Code's "Type something" row.
export const takesText = (q: Question) => !q.multiSelect && !hasPreviews(q);

export function answerOf(q: Question, d: QuestionDraft): Answer | null {
  if (takesText(q) && d.text.trim()) return { text: d.text.trim() };
  if (!d.picks.length) return null;
  const notes = d.notes?.trim();
  return notes ? { picks: d.picks, notes } : { picks: d.picks };
}
