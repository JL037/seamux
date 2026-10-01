# Background sessions

Claude Code chats that run on without a terminal: moved to the background from a chat, or started as background jobs, and reopened with `claude attach`. Claude Code keeps each job in `~/.claude/jobs/<short id>`. `claude agents --json --all` lists them beside the live chats, which is where most of the surprises are.

## A background session without a process is still listed

`claude agents --json --all` keeps a stopped or dead background session with its last `state`, `blocked` for one that stopped on a question, but with no `pid` or `status`, and `claude logs` reports it not found. `claude attach <id>` restarts it with its conversation, even when its transcript file is missing, since it restores from the job in `~/.claude/jobs/<id>`. Once running it has a `pid` and `status` again.

- **Measured:** not recorded.
- **In seamux:** `toBackground` and `backgroundDetail` in [board.server.ts](../app/lib/board.server.ts), and `attach` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [Idle and waiting are separate `status` values](session-state.md#idle-and-waiting-are-separate-status-values).

## `claude agents` cannot tell an attached background session from a detached one

A running background session reports the same row, `status` included, whether or not a terminal has it open, and closing the terminal leaves it running. Only the `claude attach <id>` process shows it is attached, so the board looks for that process.

- **Measured:** Claude Code 2.1.282.
- **In seamux:** `attachedTo` in [board.server.ts](../app/lib/board.server.ts), which reads `ps`.

## A chat moved to the background keeps its old transcript apart

The job takes the first 8 characters of the chat's session id as its short id but runs on under a new session id, while the old transcript is still written to, for instance when an attached terminal closes. The board hides a closed-chat card whose id starts with a listed job's short id.

- **Measured:** not recorded.
- **In seamux:** [board.server.ts](../app/lib/board.server.ts), where a job's short id is its `id` or the first 8 characters of its `sessionId`.
- **See also:** [`/clear` keeps the process and changes the session id](session-state.md#clear-keeps-the-process-and-changes-the-session-id).

## cmux's wrapper passes `claude` subcommands straight through

`attach`, `agents` and the rest get no session id or hook settings, so a session opened with `claude attach` has no cmux surface the board can find, and its card cannot be typed into from the board.

- **Measured:** not recorded.
- **See also:** [That login shell does not read `~/.zshrc`](launching.md#that-login-shell-does-not-read-zshrc), which covers the wrapper every launch goes through.
