---
"seamux": minor
---

The first public release. seamux installs from npm and runs as a compiled board with `npx seamux`, keeping its settings and state in `~/.seamux` (or `SEAMUX_HOME`). The first run installs the subagent hooks and the dispatch skill, and later runs keep them up to date; `npx seamux uninstall` removes them, and keeps the board from starting until `npx seamux setup`. It finds `claude`, cmux and your shell wherever they're installed, dispatches into any directory, and can blur the board for screenshots from the Debug tab.
