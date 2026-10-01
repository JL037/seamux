# Slash commands

Which slash commands a chat offers, for the board's own command picker, and what the slash menu does to a prompt box. Individual commands have their findings where they matter: [`/clear`](session-state.md#clear-keeps-the-process-and-changes-the-session-id), [`/rename`](names.md#rename-works-mid-turn-and-a-closed-chat-can-be-renamed-through-its-transcript), [`/exit`](dialogs.md#other-dialogs-are-waitingfor-dialog-open-and-a-digit-picks-and-confirms), and a typed slash command [running on Enter even with the menu open](prompt-box.md#a-long-paste-folds-into-a-placeholder-even-on-one-line-and-the-model-gets-it-as-pasted-content).

## cmux can read Claude Code's slash menu, but it is no source for a list

Typing `/` into a surface and calling `read-screen` shows the menu as text, a command and its description per row, filtered as more is typed. It shows about five rows at a time, the selected one is marked only by colour, and paging it means typing into the session's own prompt box. Esc closes the menu but leaves the `/`, so a paste after it went in as `//exit` and ran a turn.

- **Measured:** Claude Code 2.1.282.
- **See also:** [A headless session lists its slash commands before any prompt](#a-headless-session-lists-its-slash-commands-before-any-prompt), what seamux does instead, and [Ctrl+E, Ctrl+U and Backspace empty a prompt box](prompt-box.md#ctrle-ctrlu-and-backspace-empty-a-prompt-box-a-line-at-a-time-in-claude-code-and-codex-alike), which clears a stray `/`.

## A headless session lists its slash commands before any prompt

`claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence` prints `{"type":"system","subtype":"commands_changed","commands":[...]}` as its first line, each command with `name`, `description` and `argumentHint`, in about two seconds; closing stdin then runs no turn. It covers built-ins, skills and MCP prompts for that folder, but not the terminal-only commands (`/add-dir`, `/artifacts` and others), and plugin skills lose their prefix (`docs`, where the transcript's `skill_listing` says `anthropic-skills:docs`).

- **Measured:** Claude Code 2.1.282.
- **In seamux:** [commands.server.ts](../app/lib/commands.server.ts), which caches the list per folder.
