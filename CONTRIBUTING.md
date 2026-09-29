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

- `npm run typecheck` must pass. There are no tests yet.
- Try a new cmux or Claude Code call against a throwaway session in its own cmux workspace, never against sessions you care about, and close the workspace afterwards.
- Several documented cmux and Claude Code behaviours turned out wrong when seamux ran them. [docs/findings.md](docs/findings.md) lists them. Add to it when a tool surprises you, and say which version you measured.
- Prose is checked with [Taskless](https://taskless.io); its rules are in `.taskless/`.

## Release notes

If your change alters what someone running seamux gets, add a changeset: run `npx changeset`, pick `patch`, and describe the change for them. It becomes the change's line in `CHANGELOG.md` when seamux next releases. Docs, CI and refactors need none. While seamux is `0.y.z`, new features are `patch` too; save `minor` for something people must react to, and say what they must do. A pull request without a changeset gets a warning, never a failure.

Releases are cut by merging the "Version Packages" pull request that GitHub Actions keeps open, which publishes to npm and tags the release.

## Rules the code keeps

`CLAUDE.md` lists them in full, and agents working on seamux read it. The ones a change most often runs into:

- **seamux never destroys.** No command deletes a session, worktree or transcript. When something should go, seamux asks the session that owns it.
- **Localhost only, except mDNS and the tunnel.** Every action goes through `assertFromBoard` in `app/lib/guard.server.ts`.
- **Derive, don't store.** Session state comes from `claude agents`, cmux and the transcripts on every poll. The store holds only what nothing else records.
- **Always pass a surface to cmux.** Its RPCs default to the caller's own terminal.

## Screenshots

To share a screenshot of your board in an issue, turn on **Blur cards for screenshots** in the cog menu's Debug tab first. Mark any new element that shows what a chat says or where it runs with the `sensitive` class, so the blur covers it.
