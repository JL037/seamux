# seamux

A board over every Claude Code session on this Mac, and the tools to drive and dispatch them. `README.md` covers setup, configuration and how it works; keep it current when behaviour changes. Prose is checked with Taskless.

## Rules

- **seamux never destroys.** The tool has no `claude rm`, no `git worktree remove`, nothing that deletes a session, worktree or transcript. When something should be removed, the session that owns it does it: seamux sends it a prompt asking.
- **Localhost only.** The server binds `127.0.0.1`, and every action goes through `assertFromBoard` in `app/lib/guard.server.ts`.
- **Derive, don't store.** Session state comes from `claude agents --json`, cmux, and the transcripts on every poll. The store (`app/lib/store.server.ts`) holds only what nothing else records: subagent lifecycle, dispatch intent, pins, queued messages, and settings.
- **Always pass a surface to cmux.** cmux RPCs default to the caller's own surface, which is whatever terminal seamux runs in.
- **Verify tool behaviour by running it.** Several documented cmux and Claude Code behaviours turned out wrong; `docs/findings.md` lists them, and new ones go there.

## Layout

- `app/lib/board.server.ts`: derives the board. `drive.server.ts`: every write verb, through cmux. `queue.server.ts`: sends queued messages once their chat is idle. `protocol.server.ts`: fan-out manifests and markers. `config.ts` / `config.server.ts`: settings and the system macros' defaults.
- `hooks/subagent-event.ts` and `scripts/seamux.ts` run under plain Node with type stripping, and so does everything they import: relative imports with `.ts` extensions, `import type`, no enums.
- `skills/seamux-dispatch/SKILL.md` is a template; `npm run skills:install` renders it into `~/.claude/skills`.

## Working on seamux

The board runs from the main checkout, on `main`, under `npm run serve`, which keeps the dev server up and restarts it when needed. Never edit the main checkout directly: it is what the board serves.

1. Work in your own worktree, on your own branch. A session dispatched from the board with "new worktree" already has one, under `.claude/worktrees/`, branched from main; otherwise make one under `worktrees/<name>`.
2. Commit, then run `npm run land` from the worktree. It waits for any other landing to finish, rebases your branch onto main, typechecks it, fast-forwards main, and restarts the board if dependencies or any `.server.ts` module changed; otherwise hot reload picks the change up within seconds.
3. If it reports a conflict, rebase onto main yourself, resolve, and run it again. main is untouched until a landing succeeds.
4. Once landed, as your very last step, remove your own worktree and branch (`git -C <main checkout> worktree remove <your worktree>`, then `git branch -d`), and never anyone else's. Jakob closes the chat from the board.

## Checking changes

- `npm run typecheck`.
- Try new cmux or Claude Code calls against a throwaway session in its own cmux workspace, never against Jakob's live sessions, and close the workspace afterwards.
