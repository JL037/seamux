---
"seamux": minor
---

The first public release. seamux installs from npm and runs as a compiled board with `npx seamux`, keeping its settings and state in `~/.seamux` (or `SEAMUX_HOME`). Run `npx seamux setup` once to install the subagent hooks and the dispatch skill, and `npx seamux uninstall` to remove them. It finds `claude`, cmux and your shell wherever they're installed, dispatches into any directory, and can blur the board for screenshots from the Debug tab.
