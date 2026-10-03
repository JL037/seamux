# Dialogs

The numbered dialogs Claude Code opens over its prompt box: permission prompts, AskUserQuestion, and the rest, such as `/exit`'s "Background work is running". `claude agents` says one is open, with `status: waiting` and a `waitingFor` naming the kind ([Idle and waiting are separate `status` values](session-state.md#idle-and-waiting-are-separate-status-values)). seamux reads the dialog off the screen and answers it with keys. Keys sent too fast while a dialog redraws are dropped, so macros leave a gap between them (`KEY_GAP_MS` in [macros.server.ts](../app/lib/macros.server.ts)).

Dialogs elsewhere: [the trust dialog](launching.md#a-new-folder-stops-on-a-trust-dialog-that-nothing-reports), which nothing reports, and Codex's [approvals](codex.md#an-open-approval-is-a-tool-call-with-no-output) and [trust dialog](codex.md#the-trust-dialog-defaults-to-yes).

## Other dialogs are `waitingFor: "dialog open"`, and a digit picks and confirms

`/exit` with a background shell running opens "Background work is running" (Exit and stop tasks, Move to background and exit, Stay), which `claude agents` reports as `dialog open`. Pressing `3` stayed and `1` exited, stopping the shell, with no Enter needed.

- **Measured:** Claude Code 2.1.281.
- **In seamux:** `parseDialog` and `answerDialog` in [drive.server.ts](../app/lib/drive.server.ts), and `pick` in [macros.server.ts](../app/lib/macros.server.ts).

## A permission prompt's "No" has no fixed number

A Bash approval offers Yes, an always-allow, sometimes a switch to auto mode, then No, so No is 3 or 4. 1 is always Yes, and Esc denies.

- **Measured:** Claude Code 2.1.281.
- **In seamux:** `approve` and `deny` in [macros.server.ts](../app/lib/macros.server.ts), and `approveKey` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [An open approval is a tool call with no output](codex.md#an-open-approval-is-a-tool-call-with-no-output), Codex's version, and [A tool's own confirmation numbers nothing](#a-tools-own-confirmation-numbers-nothing-puts-no-first-and-ignores-digits), where 1 isn't Yes.

## A tool's own confirmation numbers nothing, puts No first, and ignores digits

The Artifact tool's delete doesn't open the usual permission prompt. `claude agents` still reports it as `waitingFor: "permission prompt"`, and the transcript holds the pending `Artifact` call, but the screen shows its own question with two unnumbered rows, the cursor on No:

```
 Permanently delete "Dialog Probe"?

 ❯ No
   Yes

 Esc to cancel · Tab to amend
```

Against a throwaway artifact: `1`, `2` and `y` did nothing, and nothing reached the prompt box either. `down` moved the cursor to Yes, and `enter` deleted the artifact. A Bash approval in the same chat was still numbered, with Yes as 1. The tool checks the artifact exists before it asks, so a made-up URL fails without ever opening the dialog.

- **Measured:** Claude Code 2.1.289, cmux 0.64.23.
- **In seamux:** `cursorOptions` and `answerDialog` in [drive.server.ts](../app/lib/drive.server.ts), `pick` in [macros.server.ts](../app/lib/macros.server.ts), and the board swapping the approval for the dialog in [board.server.ts](../app/lib/board.server.ts).
- **See also:** [A permission prompt's "No" has no fixed number](#a-permission-prompts-no-has-no-fixed-number), [A new folder stops on a trust dialog that nothing reports](launching.md#a-new-folder-stops-on-a-trust-dialog-that-nothing-reports), which is unnumbered the same way.

## AskUserQuestion answers by digit

On a single-select question a digit picks and moves on, and it submits outright when it is the only question. On a multi-select question, digits toggle and Tab moves on. The digit after the last option is "Type something", and a paste there submits the text. With several questions, or any multi-select one, a review screen comes last and `1` submits it.

- **Measured:** Claude Code 2.1.281.
- **In seamux:** `answerQuestion` in [macros.server.ts](../app/lib/macros.server.ts).
- **See also:** [AskUserQuestion's "Type something" takes typed text too](#askuserquestions-type-something-takes-typed-text-too), [A question with previews is a different dialog](#a-question-with-previews-is-a-different-dialog).

## AskUserQuestion's "Type something" takes typed text too

On a single-select question its digit puts the cursor in the field, and typed text needs an Enter to submit. On a multi-select question the digit only ticks the row and leaves the cursor where it was, so text typed or pasted after it is lost; walking the cursor down to the row with arrow keys puts it in the field. Typed there, the answer needs a Tab down to "Next" and an Enter; pasted, it moves on by itself. Keys sent too fast while the dialog redraws are dropped.

- **Measured:** Claude Code 2.1.282.
- **In seamux:** `answerQuestion` and `KEY_GAP_MS` in [macros.server.ts](../app/lib/macros.server.ts).
- **See also:** [Typed input that comes too fast is taken for a paste](prompt-box.md#typed-input-that-comes-too-fast-is-taken-for-a-paste-and-mangled).

## A question with previews is a different dialog

When its options carry a `preview`, Claude Code shows the one under the cursor beside the list, drops the "Type something" row, and a digit only moves the cursor, so Enter is what picks. `n` opens a one-line note on that option, typed text fills it, and Enter picks the option with the note, which the model gets as `notes: …` after the answer. A question without previews offers no note.

- **Measured:** Claude Code 2.1.282.
- **In seamux:** `answerQuestion` in [macros.server.ts](../app/lib/macros.server.ts), and the board's side in [waiting-panel.tsx](../app/components/waiting-panel.tsx).

## Two Escs on an idle Claude Code chat open Rewind

With a turn already over, two Escs in a row opened "Rewind": "Restore the code and/or conversation to the point before…", listing the chat's prompts with "(current)" selected, and "Enter to continue · Esc to cancel" below. One more Esc closed it. Two Escs during a turn, before any reply showed, stopped it and put the prompt back in the box, as one Esc does, with no Rewind. So a Stop of two Escs that lands as a turn ends leaves Rewind open, and the chat waiting on a dialog nobody asked for.

- **Measured:** Claude Code 2.1.287, cmux 0.64.25.
- **In seamux:** `interrupt` in [macros.server.ts](../app/lib/macros.server.ts) presses one Esc.
- **See also:** [Esc twice interrupts a turn](opencode.md#esc-twice-interrupts-a-turn) in OpenCode, where one Esc doesn't.
