# Getting started

This page covers installing seamux, running the board, and every setting it has. To reach the board from your phone or another computer, see [Remote connections](remote-connections.md).

## What you need

- **macOS** with [cmux](https://cmux.dev), in `/Applications` or `~/Applications` (or set `SEAMUX_CMUX_APP`), and its `cmux` command on your `PATH`. seamux drives sessions by typing into their cmux terminals, so a session outside cmux is shown but can't be driven.
- **Claude Code**, with `claude` on your `PATH` (`~/.local/bin` is where the installer puts it).
- **Codex**, optionally, installed with npm or pnpm (next to `node`) or Homebrew. Run `cmux hooks setup codex` once so cmux tracks its sessions.
- **Node 24** or later, for `node:sqlite`, and in a clone for running TypeScript directly.
- **A shell whose startup files set up your `PATH`.** Every session seamux starts runs in an interactive instance of your login shell (`$SHELL`), so it gets the same tools a terminal opened by hand does. zsh and bash are tested.

## Install and run

There are two ways to run seamux: the published package, which runs a compiled board, or a clone of this repo, which runs the dev server so a change goes live as soon as it's saved.

### From npm

```bash
npx seamux   # run the board on http://127.0.0.1:54321 and keep it running
```

The first run sets seamux up: it installs the subagent hooks and the dispatch skill, and says what it changed (see [What setup changes](#what-setup-changes-outside-seamux)). Later runs keep them up to date, quietly unless something changed.

seamux keeps its settings and state in `~/.seamux`: its `.env`, `.seamux.json`, and `data/`. Set `SEAMUX_HOME` to keep them somewhere else. It also keeps copies of the hook and the fan-out CLI in `~/.seamux/bin`, which sessions call, since npx's cache can be emptied at any time. Each start of the board refreshes them, so upgrading seamux upgrades them too.

### From a clone

```bash
npm install
npm run seamux   # set seamux up, then run the board on http://127.0.0.1:54321 and keep it running
```

A clone keeps its settings and state in the clone itself, all gitignored. `npm start` builds and runs the compiled board instead of the dev server, as the npm package does.

### Running the board

Run the board in its own cmux workspace. It supervises the server: it restarts it if it exits or stops answering, and refuses to run twice.

The same command is `bin/seamux`, the package's `seamux` bin: in a clone, run `npm link` once and `seamux` starts the board from anywhere. With a command, such as `seamux list`, it's the fan-out CLI the README describes.

### What setup changes outside seamux

Starting the board, or `npx seamux setup`, writes to two places outside seamux's own directory, when they aren't already right. Both are safe to repeat and both can be undone:

- **`~/.claude/settings.json`** gets `SubagentStart` and `SubagentStop` hooks that run seamux's subagent hook, so the board can see subagents in every session. The file is backed up first.
- **`~/.claude/skills/seamux-dispatch/`** gets the fan-out skill, rendered with the path of the `seamux` command sessions call.

### Uninstall

```bash
npx seamux uninstall   # or, in a clone, bin/seamux uninstall
```

That takes seamux's hooks out of `~/.claude/settings.json`, and nothing else there, and removes the seamux-dispatch skill. It also remembers the uninstall: from then on the board won't start, and says to run `npx seamux setup` (or `bin/seamux setup`), which installs both again. To remove seamux entirely, delete `~/.seamux`, or the clone. Its `data/` holds seamux's store, fan-out records and logs, and nothing any session needs: your sessions and transcripts are Claude Code's and Codex's, and stay where they are.

## Set a password

Put `SEAMUX_USER` and `SEAMUX_PASS` in the `.env` in seamux's home (`~/.seamux/.env`, or at the root of a clone, where it's gitignored), or in the environment, and the board asks for them with HTTP Basic auth before serving anything:

```bash
SEAMUX_USER=you
SEAMUX_PASS=something-long
```

It reads them on every request, so a change to `.env` takes effect without a restart. Set, they're asked for by every request, from this Mac too, and for every file the board serves; only a request through the Cloudflare tunnel skips them, since Cloudflare Access logs it in. With either one unset the board answers only this Mac, and mDNS won't turn on.

## Settings

Most settings live in the board. Click the cog beside the seamux name.

### General

<!-- Screenshot: the General tab -->

- **Default agent**: what the dispatch bar starts new sessions with, Claude Code or Codex. An agent that isn't installed is greyed out. The dispatch bar has a picker to change it for one dispatch. Fan-out workers always run Claude Code, since they rely on its hooks and the dispatch skill.
- **Worktrees**: whether the dispatch bar's "new worktree" switch starts on.
- **Notifications**: desktop notifications when a chat starts waiting while the board isn't the focused window. Turning it on asks the browser for permission and then sends a test notification, "Desktop Notifications are Enabled", and the choice is kept in this browser rather than the store. Browsers only allow notifications on a secure origin, so the switch is greyed out on the plain-HTTP `.local` address.
- **Directories**: what the dispatch bar's directory picker offers. When this is empty, the picker lists directories with live sessions, past dispatches, and every git repo up to two levels under the usual code folders in your home directory (`~/code`, `~/Developer`, `~/projects`, `~/src` and a few more). Any directory can be added or dispatched into, inside your home directory or not. ↓ or the chevron opens the whole list, whatever is already in the field; typing narrows it. Tab completes a partly typed path as a shell does, from that list and from the directories on disk: all the way when only one directory fits, otherwise as far as every fitting directory agrees, then opens the list of them.

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

- **Blur cards for screenshots**: blurs what each chat says, where it runs and when (names, paths, branches, how long ago, prompts, replies, questions, queued messages and open files) while the columns, layout and controls stay readable, so the board can go in a screenshot or a bug report. Kept in this browser only.
- **Diagnostics**: sends a snapshot of how this browser lays out the board to the Mac, for triage from a phone. It records the screen size, the media queries that match, the safe areas, which stylesheets are loaded and whether they carry the phone layout's rules, and every column's and card's size and computed style. It also records the service worker's state and recent script errors. A snapshot is sent when the board loads, a second after the window is resized or turned, and when you press **Send now**. The tab shows the last one, and the Mac keeps it in `data/diagnostics/latest.json`, with the last 50 in `data/diagnostics/log.jsonl`.
- **Clear this browser's cache for the board**: a link to `/reset`, which answers with `Clear-Site-Data: "cache"` and goes back to the board. It gets a browser that is stuck on old code working again, and keeps drafts, settings and the Access login. The error page links to it too.
- **Clear autocomplete cache**: forgets every folder's slash commands, so each is listed again the next time you type `/`.

### In the browser

Some choices are kept in the browser rather than the store: light or dark theme (the board follows the OS until you pick the other one with the header toggle, and again once you flip it back), whether DONE is shown, project colours, whether to send desktop notifications, whether to send diagnostics, and whether to blur cards for screenshots.

## `.seamux.json`

`.seamux.json`, in seamux's home (`~/.seamux`, or the root of a clone, gitignored), is how the board runs there. Starting the board writes it, and `npm run land` reads it to find the board:

```json
{ "port": 54321 }
```

Edit the port there, or start the board once with `SEAMUX_PORT` set, and it's kept for later runs. The Remote tab's switches are kept here too, as `remote`, `mdns` and `tunnel`.

## Environment variables

All optional. Each can go in `.env` or the environment, except `SEAMUX_HOME`, which says where that `.env` is.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEAMUX_PORT` | from `.seamux.json` | Port for the board, saved to `.seamux.json` |
| `SEAMUX_USER`, `SEAMUX_PASS` | unset | HTTP Basic credentials for the board, asked for by every request except the tunnel's. Unset leaves the board open to this Mac only, and keeps mDNS off |
| `SEAMUX_CF_TOKEN`, `SEAMUX_CF_DOMAIN`, `SEAMUX_CF_TEAM`, `SEAMUX_CF_AUD` | unset | The Cloudflare tunnel's token and hostname, and the Cloudflare Access team and AUD tag. All four are needed. See [Remote connections](remote-connections.md) |
| `SEAMUX_CF_TUNNEL` | unset | The tunnel's id, shown in the Remote tab |
| `SEAMUX_HOME` | the clone, or `~/.seamux` | Where seamux keeps `.env`, `.seamux.json` and `data/` |
| `SEAMUX_COMPILED` | unset | `1` makes a clone run the compiled board, as `npm start` does |
| `SEAMUX_DB` | `data/seamux.db` | The SQLite store |
| `SEAMUX_CMUX_APP` | `/Applications/cmux.app`, else `~/Applications/cmux.app` | Where cmux is installed, for its wrappers that launch each agent |
| `SEAMUX_DISPATCH_DIR` | `data/dispatches` | Fan-out manifests and completion markers |
| `SEAMUX_POLL` | unset | `1` makes hot reload poll for file changes. It already polls on WSL's `/mnt/` drives |
