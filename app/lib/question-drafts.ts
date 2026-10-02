import { useCallback, useSyncExternalStore } from "react";

import { hasPreviews, type Answer, type Question } from "~/lib/board";

// The picks made so far on an open AskUserQuestion, one per question. Kept
// by tool call rather than in the form, so the card's form and the chat
// modal's show the same picks, and the reply box can send them with the
// text it answers in.
export interface QuestionDraft {
  picks: number[];
  // null until "Add a note" opens the box.
  notes: string | null;
}

const drafts = new Map<string, QuestionDraft[]>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: QuestionDraft = { picks: [], notes: null };
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

// A question the reply box can answer: only a single-select one without
// previews has Claude Code's "Type something" row.
export const takesText = (q: Question) => !q.multiSelect && !hasPreviews(q);

export function pickAnswer(d: QuestionDraft): Answer | null {
  if (!d.picks.length) return null;
  const notes = d.notes?.trim();
  return notes ? { picks: d.picks, notes } : { picks: d.picks };
}

// The answers the reply box sends with `text`. It answers the one question
// left without a pick, or, once all have one, the one question that takes
// text, in place of its pick; the form's picks answer the rest. null when
// there is no such question.
export function textAnswers(
  questions: Question[],
  current: QuestionDraft[],
  text: string,
): Answer[] | null {
  const open = questions.flatMap((q, i) =>
    current[i]?.picks.length ? [] : [i],
  );
  const typed = questions.flatMap((q, i) => (takesText(q) ? [i] : []));
  const target =
    open.length === 1
      ? open[0]
      : open.length === 0 && typed.length === 1
        ? typed[0]
        : -1;
  if (!text.trim() || target < 0 || !takesText(questions[target])) return null;
  return questions.map((_, i) =>
    i === target ? { text: text.trim() } : pickAnswer(current[i])!,
  );
}
