# Getting started

This page covers installing seamux, running the board, and every setting it has. To reach the board from your phone or another computer, see [Remote connections](remote-connections.md).

## What you need

- **macOS** with [cmux](https://cmux.dev). seamux drives sessions by typing into their cmux terminals, so a session outside cmux is shown but can't be driven.
- **Claude Code**, with `claude` on your `PATH` (`~/.local/bin` is where the installer puts it).
- **Codex**, optionally, installed with npm or pnpm (next to `node`) or Homebrew. Run `cmux hooks setup codex` once so cmux tracks its sessions.
- **Node 24** or later, for `node:sqlite` and for running TypeScript directly.

## Install and run

```bash
npm run setup    # install dependencies, the subagent hooks, and the dispatch skill
npm run seamux   # run the board on http://127.0.0.1:54321 and keep it running
```

Run `npm run seamux` in its own cmux workspace. It supervises the dev server: it restarts it if it exits or stops answering, and refuses to run twice.

The same command is `bin/seamux`, also exposed as the package's `seamux` bin: run `npm link` once and `seamux` starts the board from anywhere. With a command, such as `seamux list`, it's the fan-out CLI the README describes.

<!-- Screenshot: the board, just started -->

### What setup changes outside the repo

`setup` writes to two places outside the repo. Both are safe to run again and both can be undone:

- **`~/.claude/settings.json`** gets `SubagentStart` and `SubagentStop` hooks that run `hooks/subagent-event.ts`, so the board can see subagents in every session. The file is backed up first. `npm run hooks:uninstall` removes only these entries.
- **`~/.claude/skills/seamux-dispatch/`** gets the fan-out skill, rendered with this checkout's `bin/seamux` path. `npm run skills:uninstall` removes it.

## Set a password

Put `SEAMUX_USER` and `SEAMUX_PASS` in a `.env` at the root of the checkout (gitignored), or in the environment, and the board asks for them with HTTP Basic auth before serving anything:

```bash
SEAMUX_USER=you
SEAMUX_PASS=something-long
```

It reads them on every request, so a change to `.env` takes effect without a restart. With either one unset the board still runs, but its background turns red and it calls itself "seamux (unsecured)". mDNS won't turn on without them.

<!-- Screenshot: the red "seamux (unsecured)" board -->

## Settings

Most settings live in the board. Click the cog beside the seamux name.

### General

<!-- Screenshot: the General tab -->

- **Default agent**: what the dispatch bar starts new sessions with, Claude Code or Codex. An agent that isn't installed is greyed out. The dispatch bar has a picker to change it for one dispatch. Fan-out workers always run Claude Code, since they rely on its hooks and the dispatch skill.
- **Worktrees**: whether the dispatch bar's "new worktree" switch starts on.
- **Notifications**: desktop notifications when a chat starts waiting while the board isn't the focused window. Turning it on asks the browser for permission, and the choice is kept in this browser rather than the store. Browsers only allow notifications on a secure origin, so the switch is greyed out on the plain-HTTP `.local` address.
- **Directories**: what the dispatch bar's directory picker offers. When this is empty, the picker lists directories with live sessions, past dispatches, and every git repo up to two levels under `~/code`. ↓ or the chevron opens the whole list, whatever is already in the field; typing narrows it.

### Macros

<!-- Screenshot: the Macros tab -->

Macros are prompts seamux sends into a session for you. `{{name}}` variables are filled in when the prompt is sent.

| Macro | Sent | Variables |
| --- | --- | --- |
| New session | Wrapped around the first prompt of every session seamux dispatches. Must contain `{{prompt}}`, and defaults to that followed by `{{how_to_worktree}}` | `prompt`, `cwd`, `how_to_worktree` |
| How to worktree | Filled into the new session's `{{how_to_worktree}}` when the session starts in a new worktree in a repo with no worktree convention; empty otherwise. Defaults to steps that have the session check `worktrees/` is gitignored first, then install dependencies in the worktree. A New session macro without `{{how_to_worktree}}` gets it at the end | `worktree`, `branch`, `repo` |
| Close session | When you close an idle chat, before it exits. Defaults to a cleanup prompt asking the session to remove its own worktree. Leave it empty to exit straight away | `cwd`, `repo`, `siblings` |

`{{siblings}}` is a sentence naming the other live sessions under the same repo. Without it, a session can't know that another session is using the same repo.

### Remote

Switches on remote connections: mDNS for your own network, and a Cloudflare tunnel for anywhere else. See [Remote connections](remote-connections.md).

### Debug

- **Diagnostics**: sends a snapshot of how this browser lays out the board to the Mac, for triage from a phone. It records the screen size, the media queries that match, the safe areas, which stylesheets are loaded and whether they carry the phone layout's rules, and every column's and card's size and computed style. It also records the service worker's state and recent script errors. A snapshot is sent when the board loads, a second after the window is resized or turned, and when you press **Send now**. The tab shows the last one, and the Mac keeps it in `data/diagnostics/latest.json`, with the last 50 in `data/diagnostics/log.jsonl`.
- **Clear this browser's cache for the board**: a link to `/reset`, which answers with `Clear-Site-Data: "cache"` and goes back to the board. It gets a browser that is stuck on old code working again, and keeps drafts, settings and the Access login. The error page links to it too.
- **Clear autocomplete cache**: forgets every folder's slash commands, so each is listed again the next time you type `/`.

### In the browser

Some choices are kept in the browser rather than the store: light or dark theme, whether DONE is shown, project colours, whether to send desktop notifications, and whether to send diagnostics.

## `.seamux.json`

`.seamux.json`, at the root of the checkout and gitignored, is how that checkout runs the board. `npm run seamux` writes it, and `npm run land` reads it to find the board:

```json
{ "port": 54321 }
```

Edit the port there, or start `npm run seamux` once with `SEAMUX_PORT` set, and it's kept for later runs. The Remote tab's switches are kept here too, as `remote`, `mdns` and `tunnel`.

## Environment variables

All optional. Each can go in `.env` or the environment.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEAMUX_PORT` | from `.seamux.json` | Port for `npm run seamux`, saved to `.seamux.json` |
| `SEAMUX_USER`, `SEAMUX_PASS` | unset | HTTP Basic credentials for the board. Unset leaves the board unsecured on this Mac, and keeps mDNS off |
| `SEAMUX_CF_TOKEN`, `SEAMUX_CF_DOMAIN`, `SEAMUX_CF_TEAM`, `SEAMUX_CF_AUD` | unset | The Cloudflare tunnel's token and hostname, and the Cloudflare Access team and AUD tag. All four are needed. See [Remote connections](remote-connections.md) |
| `SEAMUX_CF_TUNNEL` | unset | The tunnel's id, shown in the Remote tab |
| `SEAMUX_DB` | `data/seamux.db` | The SQLite store |
| `SEAMUX_DISPATCH_DIR` | `data/dispatches` | Fan-out manifests and completion markers |
| `SEAMUX_POLL` | unset | `1` makes hot reload poll for file changes. It already polls on WSL's `/mnt/` drives |
