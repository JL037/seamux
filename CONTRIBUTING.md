# Contributing

Issues and pull requests are welcome. For anything bigger than a fix, open an issue first so we can agree on the shape before you build it.

## Setting up

Follow [Getting started](docs/getting-started.md): macOS, cmux, Claude Code and Node 24 or later, then `npm run setup` and `npm run seamux`.

## Making a change

The board you're running serves from your checkout, and hot reload applies every saved file within seconds, so a half-finished change breaks the board you're using. Work in a git worktree on its own branch instead, and bring the change into the checkout the board runs from once it's done:

1. Make a worktree, under `worktrees/` or `.claude/worktrees/` (both gitignored), and run `npm install` in it. Don't symlink `node_modules` into it.
2. Commit, then run `npm run land` from the worktree. It rebases your branch onto `main`, typechecks it, fast-forwards `main`, and restarts the board if dependencies or a `.server.ts` module changed.

For a pull request, push your branch and open the PR against `main` instead of landing it.

## Checking a change

- `npm run typecheck`, `npm test` and `npm run build` must pass; CI runs all three on every pull request.
- The tests run against a fake cmux (`test/fake-cmux.ts`), which speaks cmux's socket protocol and answers `cmux sessions list`, so they need neither cmux nor Claude Code installed, and never touch your real sessions. When seamux starts making a new cmux call, the fake refuses it as an unknown method until you teach it that method, which is also when to add a test pinning down what seamux sends.
- Try a new cmux or Claude Code call against a throwaway session in its own cmux workspace, never against sessions you care about, and close the workspace afterwards.
- Several documented cmux and Claude Code behaviours turned out wrong when seamux ran them. [docs/findings.md](docs/findings.md) lists them. Add to it when a tool surprises you, and say which version you measured.
- Prose is checked with [Taskless](https://taskless.io); its rules are in `.taskless/`.

## Release notes

If your change alters what someone running seamux gets, add a changeset: run `npx changeset` and describe the change for them. It becomes the change's line in `CHANGELOG.md` when seamux next releases. Docs, CI and refactors need none. A pull request without a changeset gets a warning, never a failure.

seamux is pre-1.0, so a changeset is one of two bumps, never `major`:

- **`minor`**: a change people may have to migrate to or adopt, such as a moved setting, a new requirement or a changed command. Say in the changeset what they must do.
- **`patch`**: a bug fix, or a small addition that asks nothing of them.

Releases are cut by merging the "Version Packages" pull request that GitHub Actions keeps open, which publishes to npm, tags the release and creates its GitHub Release.

## Rules the code keeps

`CLAUDE.md` lists them in full, and agents working on seamux read it. The ones a change most often runs into:

- **seamux never destroys.** No command deletes a session, worktree or transcript. When something should go, seamux asks the session that owns it.
- **Localhost only, except mDNS and the tunnel.** Every action goes through `assertFromBoard` in `app/lib/guard.server.ts`.
- **Derive, don't store.** Session state comes from `claude agents`, cmux and the transcripts on every poll. The store holds only what nothing else records.
- **Always pass a surface to cmux.** Its RPCs default to the caller's own terminal.

## Screenshots

To share a screenshot of your board in an issue, turn on **Blur cards for screenshots** in the cog menu's Debug tab first. Mark any new element that shows what a chat says or where it runs with the `sensitive` class, so the blur covers it.
