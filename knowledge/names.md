# Names

What a chat is called, and the cmux workspace it runs in. Claude Code, Codex and cmux each keep a name of their own, in different places and on different schedules, and the board renames all of them together. Every new session also gets a name nothing else is using.

## `/rename` works mid-turn, and a closed chat can be renamed through its transcript

Typed while a turn runs, `/rename` applies at once without interrupting the turn, and `claude agents` reports the new name right away. It writes a `custom-title` and an `agent-name` line to the transcript; appending those two lines to a closed chat's transcript renames it, and `claude --resume` starts it under that name.

- **Measured:** Claude Code 2.1.281.
- **In seamux:** `renameLive` and `renameClosed` in [drive.server.ts](../app/lib/drive.server.ts), and `rename` in [macros.server.ts](../app/lib/macros.server.ts). `renameClosed` refuses while a resume is starting, since the new process would write the old name back.
- **See also:** [Codex names its own sessions after the first turn](#codex-names-its-own-sessions-after-the-first-turn), [Transcripts](transcripts.md).

## `/rename` retitles the tab, not the workspace, and cmux reports a new title late

`/rename` retitles the cmux tab, since Claude Code sets the terminal title, but not the workspace; `workspace.rename` does that. `workspace.list` reports the new title about a second later, and a workspace `workspace.create` just made about 0.2 s after it returns, so two dispatches in quick succession can both see a name as free.

- **Measured:** Claude Code 2.1.281, cmux 0.64.23.
- **In seamux:** `renameLive` in [drive.server.ts](../app/lib/drive.server.ts) renames the workspace only when the chat is its one tab, since otherwise the title covers other chats.
- **See also:** [cmux allows two workspaces with the same title](#cmux-allows-two-workspaces-with-the-same-title).

## cmux allows two workspaces with the same title

`workspace.create` made a second workspace with a title already in use, and `workspace.rename` made a third, with no error and no change to the title. seamux numbers a new session's name itself, so no two sessions or workspaces share one.

- **Measured:** cmux 0.64.23.
- **In seamux:** `namesInUse` and `freeSuffix` in [drive.server.ts](../app/lib/drive.server.ts), which add `-2`, `-3` and so on.
- **See also:** [cmux](cmux.md).

## Codex names its own sessions after the first turn

It writes them to `~/.codex/session_index.jsonl`: one `{id, thread_name, updated_at}` line per change, the last one winning. `/rename <name>` adds a line and applies at once. A line appended while the session is closed is the name it resumes under, and Codex does not rename it again.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** `codexNames` and `renameCodexSession` in [codex.server.ts](../app/lib/codex.server.ts).
- **See also:** [Codex](codex.md).
