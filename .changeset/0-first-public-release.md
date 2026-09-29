---
"seamux": minor
---

The first public release. seamux installs from npm and runs as a compiled board with `npx seamux`, keeping its settings and state in `~/.seamux` (or `SEAMUX_HOME`). The first run installs the subagent hooks and the dispatch skill, and later runs keep them up to date; `npx seamux uninstall` removes them, and keeps the board from starting until `npx seamux setup`. It finds `claude`, cmux and your shell wherever they're installed, and the header shows the version you run.

- The dispatch bar can start work in any directory, and its picker finds repos under the usual code folders (`~/code`, `~/Developer`, `~/projects`, `~/src` and a few more), not only `~/code`. Fan-out manifests take a `cwd` starting with `~/`.
- New sessions start in your own login shell (`$SHELL`) rather than always zsh, so they get the same PATH and tools a terminal does.
- Debug → **Blur cards for screenshots** blurs what each chat says and where it runs, for sharing a screenshot or attaching one to a bug report.
- The Remote tab names the `.env` it reads, wherever seamux keeps it.
