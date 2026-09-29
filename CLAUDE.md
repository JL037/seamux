# seamux

A board over every Claude Code session on this Mac, and the tools to drive and dispatch them. `README.md` covers how it works and links to `docs/getting-started.md` (setup and every setting) and `docs/remote-connections.md` (mDNS and the tunnel); keep them current when behaviour changes. Prose is checked with Taskless.

## Rules

- **seamux never destroys.** The tool has no `claude rm`, no `git worktree remove`, nothing that deletes a session, worktree or transcript. When something should be removed, the session that owns it does it: seamux sends it a prompt asking.
- **Localhost only, except mDNS and the tunnel.** The server binds `127.0.0.1`, and every action goes through `assertFromBoard` in `app/lib/guard.server.ts`. The other ways in are the Remote tab's. With mDNS on, the server listens on every interface, and Vite's own middleware (`remoteAccess` in `vite.config.ts`) refuses any request from another machine unless it is addressed to this Mac's `.local` name and carries the HTTP Basic credentials, which must be set. Through the Cloudflare tunnel, every request must carry a Cloudflare Access token that `app/lib/remote.server.ts` verifies, in both the auth middleware and Vite's own middleware. Never let a request from the network or the tunnel through on anything weaker.
- **Derive, don't store.** Session state comes from `claude agents --json`, cmux, and the transcripts on every poll. The store (`app/lib/store.server.ts`) holds only what nothing else records: subagent lifecycle, dispatch intent, pins, queued messages, and settings.
- **Always pass a surface to cmux.** cmux RPCs default to the caller's own surface, which is whatever terminal seamux runs in.
- **Blur what a chat says.** Any element that shows a session's content or where it runs (names, paths, branches, prompts, replies, questions, files) carries the `sensitive` class, which the Debug tab's screenshot blur covers.
- **Verify tool behaviour by running it.** Several documented cmux and Claude Code behaviours turned out wrong; `docs/findings.md` lists them, and new ones go there.

## Layout

- `app/lib/board.server.ts`: derives the board. `codex.server.ts`: reads Codex sessions, which have no `claude agents` of their own. `drive.server.ts`: every write verb, through cmux. `queue.server.ts`: sends queued messages once their chat is idle. `protocol.server.ts`: fan-out manifests and markers. `config.ts` / `config.server.ts`: settings and the system macros' defaults. `remote.server.ts`: the Remote tab's switches, the mDNS name and network check, the tunnel's settings, and the Access token check.
- `hooks/subagent-event.ts` and `scripts/seamux.ts` run under plain Node with type stripping, and so does everything they import: relative imports with `.ts` extensions, `import type`, no enums.
- `skills/seamux-dispatch/SKILL.md` is a template; `npm run skills:install` renders it into `~/.claude/skills`.

## Working on seamux

The board runs from the main checkout, on `main`, under `npm run seamux`, which keeps the dev server up and restarts it when needed. Never edit the main checkout directly: it is what the board serves.

1. Work in your own worktree, on your own branch. A session dispatched from the board with "new worktree" already has one, under `.claude/worktrees/`, branched from main; otherwise make one under `worktrees/<name>`.
2. Commit, then run `npm run land` from the worktree. It waits for any other landing to finish, rebases your branch onto main, typechecks it, fast-forwards main, and restarts the board if dependencies or any `.server.ts` module changed; otherwise hot reload picks the change up within seconds.
3. If it reports a conflict, rebase onto main yourself, resolve, and run it again. main is untouched until a landing succeeds.
4. Once landed, as your very last step, remove your own worktree and branch (`git -C <main checkout> worktree remove <your worktree>`, then `git branch -d`), and never anyone else's. The user closes the chat from the board.

## Checking changes

- `npm run typecheck`.
- Try new cmux or Claude Code calls against a throwaway session in its own cmux workspace, never against the user's live sessions, and close the workspace afterwards.
