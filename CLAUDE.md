# seamux

A board over every Claude Code session on this Mac, and the tools to drive and dispatch them. `README.md` covers how it works and links to `docs/getting-started.md` (setup and every setting) and `docs/remote-connections.md` (mDNS and the tunnel); keep them current when behaviour changes. Prose is checked with Taskless.

## Rules

- **seamux never destroys.** The tool has no `claude rm`, no `git worktree remove`, nothing that deletes a session, worktree or transcript. When something should be removed, the session that owns it does it: seamux sends it a prompt asking.
- **Localhost only, except mDNS and the tunnel.** The server binds `127.0.0.1`, and every action goes through `assertFromBoard` in `app/lib/guard.server.ts`. The other ways in are the Remote tab's. With mDNS on, the server listens on every interface, and `remoteGate` in `app/lib/remote.server.ts`, ahead of everything the server answers, refuses any request from another machine unless it is addressed to this Mac's `.local` name and carries the HTTP Basic credentials, which must be set. Through the Cloudflare tunnel, every request must carry a Cloudflare Access token that `remote.server.ts` verifies, in both the auth middleware and that gate. The dev server runs the gate as Vite middleware (`vite.config.ts`); the compiled server (`server/serve.ts`) runs it too, after `hostAllowed`, which stands in for Vite's `allowedHosts`. Keep the two servers' checks the same, and never let a request from the network or the tunnel through on anything weaker.
- **Derive, don't store.** Session state comes from `claude agents --json`, cmux, and the transcripts on every poll. The store (`app/lib/store.server.ts`) holds only what nothing else records: subagent lifecycle, dispatch intent, pins, queued messages, and settings.
- **Always pass a surface to cmux.** cmux RPCs default to the caller's own surface, which is whatever terminal seamux runs in.
- **Blur what a chat says.** Any element that shows a session's content or where it runs (names, paths, branches, how long ago, prompts, replies, questions, files) carries the `sensitive` class, which the Debug tab's screenshot blur covers.
- **Verify tool behaviour by running it.** Several documented cmux and Claude Code behaviours turned out wrong; `docs/findings.md` lists them, and new ones go there.

## Layout

- `app/lib/board.server.ts`: derives the board. `codex.server.ts`: reads Codex sessions, which have no `claude agents` of their own. `drive.server.ts`: every write verb, through cmux. `queue.server.ts`: sends queued messages once their chat is idle. `protocol.server.ts`: fan-out manifests and markers. `config.ts` / `config.server.ts`: settings and the system macros' defaults. `remote.server.ts`: the Remote tab's switches, the mDNS name and network check, the tunnel's settings, and the Access token check.
- `app/lib/paths.server.ts`: where the package is, and `SEAMUX_HOME`, where `.env`, `.seamux.json` and `data/` live: the checkout, or `~/.seamux` for an installed package. Read state from there, never from `process.cwd()` or a path relative to a module.
- `hooks/subagent-event.ts`, everything under `scripts/` and `server/serve.ts` run under plain Node with type stripping in a checkout, and so does everything they import: relative imports with `.ts` extensions, `import type`, no enums. `npm run build` bundles them into `dist/` (`scripts/build-dist.ts`) for an installed package, where Node won't strip types. `bin/seamux` runs the TypeScript in a checkout and `dist/` otherwise.
- `server/serve.ts`: the compiled board, which the supervisor runs in place of the dev server for an installed package, or with `SEAMUX_COMPILED=1` (`npm start`).
- `skills/seamux-dispatch/SKILL.md` is a template; `npm run skills:install` (or `seamux setup`) renders it into `~/.claude/skills`.

## Working on seamux

The board runs from the main checkout, on `main`, under `npm run seamux`, which keeps the dev server up and restarts it when needed. Never edit the main checkout directly: it is what the board serves.

1. Work in your own worktree, on your own branch. A session dispatched from the board with "new worktree" already has one, under `.claude/worktrees/`, branched from main; otherwise make one under `worktrees/<name>`.
2. If the change alters what someone running seamux gets, add a changeset in the same commit (see Release notes below). Commit, then run `npm run land` from the worktree. It waits for any other landing to finish, rebases your branch onto main, typechecks it, fast-forwards main, and restarts the board if dependencies or any `.server.ts` module changed; otherwise hot reload picks the change up within seconds.
3. If it reports a conflict, rebase onto main yourself, resolve, and run it again. main is untouched until a landing succeeds.
4. Once landed, as your very last step, remove your own worktree and branch (`git -C <main checkout> worktree remove <your worktree>`, then `git branch -d`), and never anyone else's. The user closes the chat from the board.

## Release notes

Releases come from changesets. Each change that someone running seamux would notice gets one `.changeset/<short-name>.md`, which becomes its line in `CHANGELOG.md`. Write the file by hand, since `npx changeset` is interactive:

```md
---
"seamux": patch
---

What changed, for someone running seamux: what they'll see, and anything they must do.
```

- **One change, one changeset.** A later commit on the same change extends the existing file instead of adding a second.
- **`patch` while seamux is `0.y.z`**, new features included: semver makes no stability promise before 1.0. Use `minor` only for a change someone must react to, such as a moved setting or a new requirement, and say in the note what they must do.
- **No changeset** for what nobody running seamux sees: docs, CI, refactors, tooling.

On GitHub, `release-version.yml` keeps a "Version Packages" pull request open that folds pending changesets into `CHANGELOG.md` and bumps the version, and merging it releases: `release.yml` publishes the new version to npm through trusted publishing, once someone approves the `npm-production` environment, then tags `v<version>` and creates its GitHub Release from `CHANGELOG.md`.

## Checking changes

- `npm run typecheck`.
- Try new cmux or Claude Code calls against a throwaway session in its own cmux workspace, never against the user's live sessions, and close the workspace afterwards.
