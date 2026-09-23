# seemux

A board over every Claude Code session on this Mac, and the tools to drive and dispatch them. `README.md` is the brief and the source of truth for the design; keep it current when behaviour changes. Prose is checked with Taskless.

## Rules

- **seemux never destroys.** The tool has no `claude rm`, no `git worktree remove`, nothing that deletes a session, worktree or transcript. When something should be removed, the session that owns it does it: seemux sends it a prompt asking.
- **Localhost only.** The server binds `127.0.0.1`, and every action goes through `assertFromBoard` in `app/lib/guard.server.ts`.
- **Derive, don't store.** Session state comes from `claude agents --json`, cmux, and the transcripts on every poll. The store (`app/lib/store.server.ts`) holds only what nothing else records: subagent lifecycle and dispatch intent.
- **Always pass a surface to cmux.** cmux RPCs default to the caller's own surface, which is whatever terminal seemux runs in.
- **Verify tool behaviour by running it.** Several documented cmux and Claude Code behaviours turned out wrong; the brief's "Findings while building" lists them.

## Layout

- `app/lib/board.server.ts`: derives the board. `drive.server.ts`: every write verb, through cmux. `protocol.server.ts`: fan-out manifests and markers.
- `hooks/subagent-event.ts` and `scripts/seemux.ts` run under plain Node with type stripping, and so does everything they import: relative imports with `.ts` extensions, `import type`, no enums.
- `skills/seemux-dispatch/SKILL.md` is a template; `npm run skills:install` renders it into `~/.claude/skills`.

## Working on seemux

The board runs from the main checkout, on `main`, under `npm run serve`, which keeps the dev server up and restarts it when needed. Never edit the main checkout directly: it is what the board serves.

1. Work in your own worktree, on your own branch. Sessions started with a new worktree already have one under `.claude/worktrees/`; otherwise make one under `worktrees/<name>`.
2. Commit, then run `npm run land` from the worktree. It waits for any other landing to finish, rebases your branch onto main, typechecks it, fast-forwards main, and restarts the board only if dependencies changed; otherwise hot reload picks the change up within seconds.
3. If it reports a conflict, rebase onto main yourself, resolve, and run it again. main is untouched until a landing succeeds.
4. Once landed, remove your own worktree and branch (`git worktree remove`, `git branch -d`), and never anyone else's.

## Checking changes

- `npm run typecheck`.
- Try new cmux or Claude Code calls against a throwaway session in its own cmux workspace, never against Jakob's live sessions, and close the workspace afterwards.
