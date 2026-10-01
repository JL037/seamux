# Transcripts

Claude Code writes each chat to a `.jsonl` transcript under `~/.claude/projects/`, one JSON object per line, as each message completes. seamux reads them on every poll for what nothing else reports: whether a turn is over, what's queued, how full the context is, and what a `!` command printed. Codex transcripts are a different format, covered in [Codex](codex.md#the-record-names-the-transcript).

Entries about transcripts that live in other domains:

- [`status: busy` does not mean a turn is running](session-state.md#status-busy-does-not-mean-a-turn-is-running): the transcript's last message decides whether a turn is over.
- [`/clear` keeps the process and changes the session id](session-state.md#clear-keeps-the-process-and-changes-the-session-id): a new transcript for the same process.
- [Claude Code records subagents on disk](subagents.md#claude-code-records-subagents-on-disk), next to the parent's transcript.
- [A long paste folds into a placeholder](prompt-box.md#a-long-paste-folds-into-a-placeholder-even-on-one-line-and-the-model-gets-it-as-pasted-content): the transcript wraps it in `<pasted_content>`.
- [An expired login is in the transcript](signing-in.md#an-expired-login-is-in-the-transcript), as are API errors.
- [`/rename` works mid-turn](names.md#rename-works-mid-turn-and-a-closed-chat-can-be-renamed-through-its-transcript): two lines appended to a transcript rename a closed chat.

## The transcript logs the input queue, but a dequeue is not first in, first out

Each change is a `queue-operation` line: `enqueue` with the item's text, `dequeue`, `remove` with the text it drops, and `popAll`. A `dequeue` takes a typed prompt ahead of queued `<task-notification>` and `<agent-message>` hand-backs, which is how replaying the log leaves no typed prompt queued in any closed transcript. The board replays it to count and list what is queued in the terminal.

- **Measured:** not recorded.
- **In seamux:** `queuedPrompts` in [board.server.ts](../app/lib/board.server.ts). The board's own queue, for messages waiting on an idle chat, is separate: [queue.server.ts](../app/lib/queue.server.ts).

## Transcripts do not record the context window

Each response logs its token usage, but a 1M-token Opus session is logged as plain `claude-opus-5`, the same as a 200k one; only `/context` output names `[1m]`. Opus sessions here have run to 999k, so the context bar assumes 1M for Opus and 200k for anything else, raising it to 1M once a response holds more than 200k.

- **Measured:** not recorded.
- **In seamux:** `WINDOW`, `LARGE_WINDOW` and `contextUsage` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** Codex does record it, as `model_context_window`: [The record names the transcript](codex.md#the-record-names-the-transcript).

## A `!` command moves to the background after 120 seconds, and its output leaves the transcript

The transcript logs the command as a user turn `<bash-input>…</bash-input>` and, once it returns, `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`. Nothing is written while it runs, and the terminal is the only place its live output shows. One still running at 120 seconds is moved to the background, and its `<bash-stdout>` then says only that the output is being written to `…/tasks/<id>.output`; what it printed, such as a login's URL and code, is in that file, which keeps growing until the command exits.

- **Measured:** Claude Code 2.1.283.
- **In seamux:** `BACKGROUNDED` and `shellOutput` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** [A prompt box in shell mode runs what it holds as shell commands](prompt-box.md#a-prompt-box-in-shell-mode-runs-what-it-holds-as-shell-commands), [`claude auth login` needs no terminal](signing-in.md#claude-auth-login-needs-no-terminal).
