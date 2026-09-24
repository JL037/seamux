import { useState } from "react";
import { Check, CircleHelp, ShieldQuestion } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  ASKED_IN_REPLY,
  type Answer,
  type Card,
  type Question,
  type Waiting,
} from "~/lib/board";
import { useSessionAction } from "~/lib/use-session-action";
import { cn } from "~/lib/utils";

interface Draft {
  picks: number[];
  text: string;
}

function answerOf(q: Question, d: Draft): Answer | null {
  if (!q.multiSelect && d.text.trim()) return { text: d.text.trim() };
  return d.picks.length ? { picks: d.picks } : null;
}

// An open AskUserQuestion, answered from the card. The board drives the
// same dialog Jakob would see in the terminal.
function QuestionForm({
  card,
  ask,
}: {
  card: Card;
  ask: NonNullable<Waiting["ask"]>;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    ask.questions.map(() => ({ picks: [], text: "" })),
  );
  const { submit, pending, error } = useSessionAction(card.sessionId);
  const update = (i: number, d: Draft) =>
    setDrafts((all) => all.map((x, j) => (j === i ? d : x)));
  const answers = ask.questions.map((q, i) => answerOf(q, drafts[i]));
  const ready = card.drivable && !pending && answers.every((a) => a != null);

  const toggle = (i: number, q: Question, option: number) => {
    const { picks } = drafts[i];
    if (!q.multiSelect) return update(i, { picks: [option], text: "" });
    update(i, {
      picks: picks.includes(option)
        ? picks.filter((p) => p !== option)
        : [...picks, option].sort((a, b) => a - b),
      text: "",
    });
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) {
          submit("answer", {
            toolUseId: ask.toolUseId,
            answers: JSON.stringify(answers),
          });
        }
      }}
    >
      {ask.questions.map((q, i) => (
        <fieldset key={i} className="flex flex-col gap-1.5">
          <legend className="mb-1.5 flex items-start gap-1.5 font-medium">
            <CircleHelp className="mt-px size-3.5 shrink-0 text-amber-500" />
            <span>
              {q.question}
              {q.multiSelect && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  (pick any)
                </span>
              )}
            </span>
          </legend>
          {q.options.map((o, j) => {
            const picked = drafts[i].picks.includes(j);
            return (
              <button
                type="button"
                key={j}
                onClick={() => toggle(i, q, j)}
                aria-pressed={picked}
                title={o.description ?? undefined}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border bg-background px-2 py-1 text-left",
                  picked && "border-amber-500 bg-amber-500/10",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-3 shrink-0 items-center justify-center border",
                    q.multiSelect ? "rounded-[3px]" : "rounded-full",
                    picked && "border-amber-500 bg-amber-500 text-white",
                  )}
                >
                  {picked && <Check className="size-2.5" />}
                </span>
                <span className="min-w-0">
                  {o.label}
                  {o.description && o.description !== o.label && (
                    <span className="block text-muted-foreground">
                      {o.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {!q.multiSelect && (
            <input
              value={drafts[i].text}
              onChange={(e) => update(i, { picks: [], text: e.target.value })}
              placeholder="Or type your own answer"
              className="rounded-md border bg-background px-2 py-1 outline-none placeholder:text-muted-foreground"
            />
          )}
        </fieldset>
      ))}
      <div className="flex items-center justify-end gap-2">
        {error && <p className="text-destructive">{error}</p>}
        <Button type="submit" size="xs" disabled={!ready}>
          {pending ? "Answering…" : "Answer"}
        </Button>
      </div>
    </form>
  );
}

// An open permission prompt, answered from the card. Approve is the dialog's
// "Yes"; Deny refuses the call and ends the turn, so Jakob can reply.
function ApprovalButtons({
  card,
  approval,
}: {
  card: Card;
  approval: NonNullable<Waiting["approval"]>;
}) {
  const { submit, pending, error } = useSessionAction(card.sessionId);
  const disabled = !card.drivable || pending;
  const answer = (intent: "approve" | "deny") =>
    submit(intent, { toolUseId: approval.toolUseId });
  return (
    <div className="flex items-center justify-end gap-2">
      {error && <p className="text-destructive">{error}</p>}
      <Button
        size="xs"
        variant="outline"
        disabled={disabled}
        onClick={() => answer("deny")}
      >
        Deny
      </Button>
      <Button size="xs" disabled={disabled} onClick={() => answer("approve")}>
        {pending ? "Answering…" : "Approve"}
      </Button>
    </div>
  );
}

// What a WAITING card is blocked on: its question to answer, the question
// its reply ended on, or the tool call waiting for approval.
export function WaitingPanel({ card }: { card: Card }) {
  const w = card.waiting;
  if (!w) return null;
  if (w.ask)
    return <QuestionForm key={w.ask.toolUseId} card={card} ask={w.ask} />;
  // Answered with the reply box, like any message.
  if (w.reason === ASKED_IN_REPLY) {
    return (
      <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1">
        <CircleHelp className="mt-px size-3.5 shrink-0 text-amber-500" />
        <span className="min-w-0 break-words">
          <span className="font-medium">Asked: </span>
          {w.detail}
        </span>
      </div>
    );
  }
  const approval = w.reason === "permission prompt";
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1">
      <div className="flex items-start gap-1.5">
        <ShieldQuestion className="mt-px size-3.5 shrink-0 text-amber-500" />
        <span className="min-w-0">
          <span className="font-medium">
            {approval ? "Needs approval" : `Waiting: ${w.reason ?? "input"}`}
            {w.tool && ` · ${w.tool}`}
          </span>
          {w.detail && (
            <span className="block break-words font-mono text-muted-foreground">
              {w.detail}
            </span>
          )}
        </span>
      </div>
      {w.approval && (
        <ApprovalButtons
          key={w.approval.toolUseId}
          card={card}
          approval={w.approval}
        />
      )}
    </div>
  );
}
