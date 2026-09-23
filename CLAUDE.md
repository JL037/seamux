# seemux

A board over every Claude Code session on this Mac, and the tools to drive and dispatch them. `README.md` is the brief and the source of truth for the design; keep it current when behaviour changes. Prose is checked with Taskless.

## Rules

- **Never destroy.** No `claude rm`, no `git worktree remove`, nothing that deletes a session, worktree or transcript. When something should be removed, send the owning session a prompt asking it to do so.
- **Localhost only.** The server binds `127.0.0.1`, and every action goes through `assertFromBoard` in `app/lib/guard.server.ts`.
- **Derive, don't store.** Session state comes from `claude agents --json`, cmux, and the transcripts on every poll. The store (`app/lib/store.server.ts`) holds only what nothing else records: subagent lifecycle and dispatch intent.
- **Always pass a surface to cmux.** cmux RPCs default to the caller's own surface, which is whatever terminal seemux runs in.
- **Verify tool behaviour by running it.** Several documented cmux and Claude Code behaviours turned out wrong; the brief's "Findings while building" lists them.

## Layout

- `app/lib/board.server.ts`: derives the board. `drive.server.ts`: every write verb, through cmux. `protocol.server.ts`: fan-out manifests and markers.
- `hooks/subagent-event.ts` and `scripts/seemux.ts` run under plain Node with type stripping, and so does everything they import: relative imports with `.ts` extensions, `import type`, no enums.
- `skills/seemux-dispatch/SKILL.md` is a template; `npm run skills:install` renders it into `~/.claude/skills`.

## Landing changes

The board runs `npm run dev` from the main checkout, on `main`, under launchd (`npm run service:install`). Work happens in worktrees under `worktrees/<name>` on their own branch. `npm run land -- <branch>`, run from the main checkout, rebases the branch onto main, typechecks it, fast-forwards main, and restarts the board only if dependencies changed; otherwise hot reload picks the change up. It never deletes the branch or worktree.

## Checking changes

- `npm run typecheck`.
- Try new cmux or Claude Code calls against a throwaway session in its own cmux workspace, never against Jakob's live sessions, and close the workspace afterwards.
