# seamux

A board over every Claude Code session on this Mac, and the tools to drive and dispatch them. Each card is a live chat you can read and reply to. The columns show what each chat needs from you, and one bar starts new work as its own session.

![Board sketch](docs/board-sketch.png)

## Getting it running

You need:

- **macOS** with [cmux](https://cmux.dev). seamux drives sessions by typing into their cmux terminals, so a session outside cmux is shown but can't be driven.
- **Claude Code**, with `claude` on your `PATH` (`~/.local/bin` is where the installer puts it).
- **Node 24** or later, for `node:sqlite` and for running TypeScript directly.

```bash
npm run setup    # install dependencies, the subagent hooks, and the dispatch skill
npm run seamux   # run the board on http://127.0.0.1:5173 and keep it running
```

The same command is `bin/seamux`, also exposed as the package's `seamux` bin: run `npm link` once and `seamux` starts the board from anywhere. With a command, such as `seamux list`, it's the fan-out CLI described below.

Run `npm run seamux` in its own cmux workspace. It supervises the dev server: it restarts it if it exits or stops answering, and refuses to run twice.

`setup` writes to two places outside the repo. Both are safe to run again and both can be undone:

- **`~/.claude/settings.json`** gets `SubagentStart` and `SubagentStop` hooks that run `hooks/subagent-event.ts`, so the board can see subagents in every session. The file is backed up first. `npm run hooks:uninstall` removes only these entries.
- **`~/.claude/skills/seamux-dispatch/`** gets the fan-out skill, rendered with this checkout's `bin/seamux` path. `npm run skills:uninstall` removes it.

## Configuration

Most settings live in the board. Click the cog beside the seamux name.

**General**

- **Directories**: what the dispatch bar's directory picker offers. When this is empty, the picker lists directories with live sessions, past dispatches, and every git repo up to two levels under `~/code`.
- **New worktree by default**: whether the dispatch bar's "new worktree" box starts ticked.

**Macros** are prompts seamux sends into a session for you. `{{name}}` variables are filled in when the prompt is sent.

| Macro | Sent | Variables |
| --- | --- | --- |
| New session | Wrapped around the first prompt of every session seamux dispatches. Must contain `{{prompt}}`, and defaults to just that | `prompt`, `cwd` |
| Close session | When you close an idle chat, before it exits. Defaults to a cleanup prompt asking the session to remove its own worktree. Leave it empty to exit straight away | `cwd`, `repo`, `siblings` |

`{{siblings}}` is a sentence naming the other live sessions under the same repo. Without it, a session can't know that another session is using the same repo.

**`.seamux.json`**, at the root of the checkout and gitignored, is how that checkout runs the board. `npm run seamux` writes it, and `npm run land` reads it to find the board:

```json
{ "port": 5173 }
```

Edit the port there, or start `npm run seamux` once with `SEAMUX_PORT` set, and it's kept for later runs.

Environment variables, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEAMUX_PORT` | from `.seamux.json` | Port for `npm run seamux`, saved to `.seamux.json` |
| `SEAMUX_DB` | `data/seamux.db` | The SQLite store |
| `SEAMUX_DISPATCH_DIR` | `data/dispatches` | Fan-out manifests and completion markers |
| `SEAMUX_POLL` | unset | `1` makes hot reload poll for file changes. It already polls on WSL's `/mnt/` drives |

Some choices are kept in the browser rather than the store: light or dark theme, whether DONE is shown, and project colours.

## How it works

### Where the board comes from

The board is rebuilt every 3 seconds while the tab is visible, from:

- `claude agents --json --all`, for which sessions exist and what state each is in.
- `cmux sessions list`, which finds each session's terminal (its cmux surface) so seamux can type into it.
- The transcripts in `~/.claude/projects/`, which hold each conversation, whether a turn is still running, open questions, subagents, and how full the context window is.

The store at `data/seamux.db` holds only what those don't record: subagent lifecycle from the hooks, what each dispatched session was started for, pins and their order, queued messages, settings, and fan-out records. Deleting `data/` loses those and never a session.

### Columns

| Column | Means |
| --- | --- |
| PINNED | Sessions you've pinned as long-running. It keeps your order, which you change by dragging a card's name, and only appears while something is pinned |
| IDLE | Alive, nothing to do |
| WAITING | Stopped until you answer: a permission prompt, a question, any other dialog, or a turn that ended on a question |
| WORKING | A turn is running, or one of its subagents is |
| DONE | Closed by you. Hidden until you click **Show done**. A card stays for 30 minutes with a resume button, then drops off the board |

Each column lists its oldest card first, so the work that's been waiting longest is at the top.

Background sessions (`claude --bg`) belong to the chat that started them. They show as a marker on that chat's card, not as cards of their own. Any that no open chat accounts for are listed below the board, where you can resume one, or ask for it to be deleted.

### Cards

A card shows the last prompt and the end of the latest reply, with a reply box beneath. Clicking it opens the whole conversation.

- **Replying** pastes your text into the session's terminal and presses Enter. If the chat is working, the message waits in seamux's queue, and the card shows `working +N`. The server sends queued messages one per turn once the chat is idle, even with no board open.
- **Dialogs** are answered from the card. An approval gets Approve and Deny, an AskUserQuestion gets its options, and any other numbered dialog gets one button per option. seamux presses the same keys you would.
- **Stop** presses Esc in the session's terminal. **Fork** starts a new session with a copy of this chat's context. **Pin** moves a card into or out of PINNED.
- **Close** sends the close-session macro, waits for that turn, then sends `/exit` and closes the cmux tab. If the turn ends on a question or leaves work behind, the chat stays open with a note. Closing it again exits without sending the macro. The conversation is kept, so **resume** reopens it in a new cmux workspace.
- The **context bar** under each input fills from green to red as the context window fills, so you can wrap up or fork a chat before Claude Code compacts it.
- Links to files in a reply open in seamux's own viewer, highlighted, with rendered markdown and HTML, and it reloads while the file changes.

### Dispatching

The **dispatch bar** at the top starts a new top-level session in a chosen directory, optionally in a new worktree, with your prompt wrapped in the new-session macro. Starting new work in its own session is the point: that's cheaper than piling another goal into a chat that's already running.

A session can split a task into several at once with the `seamux-dispatch` skill, which calls `bin/seamux`:

```
seamux fanout <manifest.json | ->   declare the workers, then start each as its own session
seamux wait <dispatch-id>           wait until every worker has reported, then print every handback
seamux done <dispatch-id> <worker> --summary "…" [--result <path>] [--status ok|failed]
seamux status <dispatch-id>         where a dispatch stands, without waiting
seamux list                         every dispatch
```

A worker counts as finished only when it writes its `done` marker, not when its output file appears. The parent waits for all of them at once instead of reacting to each as it arrives. The board shows each fan-out and which workers have reported.

### Rules it keeps

- **It never destroys.** seamux has no command that deletes a session, a worktree or a transcript. When something should go, seamux sends a prompt asking the session that owns it to remove it.
- **Localhost only.** The server binds `127.0.0.1`, and every write checks that the request came from the board itself, so no other website can type into your sessions.

## Working on seamux

The board serves from the main checkout, so changes go through a worktree and `npm run land`. See `CLAUDE.md`. `docs/findings.md` lists the Claude Code and cmux behaviours that turned out to differ from their docs; read it before relying on either tool's documentation.
