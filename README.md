# seamux

A board over every Claude Code and Codex session on this Mac, and the tools to drive and dispatch them. Each card is a live chat you can read and reply to. The columns show what each chat needs from you, and one bar starts new work as its own session.

![Board sketch](docs/board-sketch.png)

## Getting it running

You need:

- **macOS** with [cmux](https://cmux.dev). seamux drives sessions by typing into their cmux terminals, so a session outside cmux is shown but can't be driven.
- **Claude Code**, with `claude` on your `PATH` (`~/.local/bin` is where the installer puts it).
- **Codex**, optionally, installed with npm or pnpm (next to `node`) or Homebrew. Run `cmux hooks setup codex` once so cmux tracks its sessions.
- **Node 24** or later, for `node:sqlite` and for running TypeScript directly.

```bash
npm run setup    # install dependencies, the subagent hooks, and the dispatch skill
npm run seamux   # run the board on http://127.0.0.1:54321 and keep it running
```

The same command is `bin/seamux`, also exposed as the package's `seamux` bin: run `npm link` once and `seamux` starts the board from anywhere. With a command, such as `seamux list`, it's the fan-out CLI described below.

Run `npm run seamux` in its own cmux workspace. It supervises the dev server: it restarts it if it exits or stops answering, and refuses to run twice.

`setup` writes to two places outside the repo. Both are safe to run again and both can be undone:

- **`~/.claude/settings.json`** gets `SubagentStart` and `SubagentStop` hooks that run `hooks/subagent-event.ts`, so the board can see subagents in every session. The file is backed up first. `npm run hooks:uninstall` removes only these entries.
- **`~/.claude/skills/seamux-dispatch/`** gets the fan-out skill, rendered with this checkout's `bin/seamux` path. `npm run skills:uninstall` removes it.

## Configuration

Most settings live in the board. Click the cog beside the seamux name.

**General**

- **Default agent**: what the dispatch bar starts new sessions with, Claude Code or Codex. An agent that isn't installed is greyed out. The dispatch bar has a picker to change it for one dispatch. Fan-out workers always run Claude Code, since they rely on its hooks and the dispatch skill.
- **Directories**: what the dispatch bar's directory picker offers. When this is empty, the picker lists directories with live sessions, past dispatches, and every git repo up to two levels under `~/code`.
- **New worktree by default**: whether the dispatch bar's "new worktree" switch starts on.

**Macros** are prompts seamux sends into a session for you. `{{name}}` variables are filled in when the prompt is sent.

| Macro | Sent | Variables |
| --- | --- | --- |
| New session | Wrapped around the first prompt of every session seamux dispatches. Must contain `{{prompt}}`, and defaults to that followed by `{{how_to_worktree}}` | `prompt`, `cwd`, `how_to_worktree` |
| How to worktree | Filled into the new session's `{{how_to_worktree}}` when the session starts in a new worktree in a repo with no worktree convention; empty otherwise. Defaults to steps that have the session check `worktrees/` is gitignored first, then install dependencies in the worktree. A New session macro without `{{how_to_worktree}}` gets it at the end | `worktree`, `branch`, `repo` |
| Close session | When you close an idle chat, before it exits. Defaults to a cleanup prompt asking the session to remove its own worktree. Leave it empty to exit straight away | `cwd`, `repo`, `siblings` |

`{{siblings}}` is a sentence naming the other live sessions under the same repo. Without it, a session can't know that another session is using the same repo.

**`.seamux.json`**, at the root of the checkout and gitignored, is how that checkout runs the board. `npm run seamux` writes it, and `npm run land` reads it to find the board:

```json
{ "port": 54321 }
```

Edit the port there, or start `npm run seamux` once with `SEAMUX_PORT` set, and it's kept for later runs.

**Password.** Put `SEAMUX_USER` and `SEAMUX_PASS` in a `.env` at the root of the checkout (gitignored), or in the environment, and the board asks for them with HTTP Basic auth before serving anything. It reads them on every request, so a change takes effect without a restart. With either one unset the board still runs, but its background turns red and it calls itself "seamux (unsecured)".

Environment variables, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEAMUX_PORT` | from `.seamux.json` | Port for `npm run seamux`, saved to `.seamux.json` |
| `SEAMUX_USER`, `SEAMUX_PASS` | unset | HTTP Basic credentials for the board, also read from `.env`. Unset leaves the board unsecured |
| `SEAMUX_DB` | `data/seamux.db` | The SQLite store |
| `SEAMUX_DISPATCH_DIR` | `data/dispatches` | Fan-out manifests and completion markers |
| `SEAMUX_POLL` | unset | `1` makes hot reload poll for file changes. It already polls on WSL's `/mnt/` drives |

Some choices are kept in the browser rather than the store: light or dark theme, whether DONE is shown, and project colours.

## How it works

### Where the board comes from

The board is rebuilt every 3 seconds while the tab is visible, from:

- `claude agents --json --all`, for which Claude Code sessions exist and what state each is in.
- `cmux sessions list`, which finds each session's terminal (its cmux surface) so seamux can type into it. It is also the only list of live Codex sessions, which is why seamux sees a Codex session only if it runs in cmux.
- The transcripts in `~/.claude/projects/` and `~/.codex/sessions/`, which hold each conversation, whether a turn is still running, open questions, subagents, and how full the context window is. cmux's own idle/running state for Codex goes stale, so a Codex card takes it from the transcript, and reads an approval off the terminal.

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
- **A multiline draft** can't be edited in the card's one-line reply box without losing its line breaks, so the box shows its first line and line count across the full width. The box, the line count and its button all open the full view instead of sending.
- **Dialogs** are answered from the card. An approval gets Approve and Deny, an AskUserQuestion gets its options, and any other numbered dialog gets one button per option. seamux presses the same keys you would.
- **Stop** presses Esc in the session's terminal. **Fork** starts a new session with a copy of this chat's context. **Pin** moves a card into or out of PINNED.
- **Rename** by double-clicking a card's name. A chat that is open in cmux is sent `/rename`, which takes effect even mid-turn and retitles its tab, but not while a dialog is open in it. Its cmux workspace is renamed too when the chat is the workspace's only tab. A closed chat gets the lines `/rename` would have written appended to its transcript, and keeps the name when resumed.
- **Close** sends the close-session macro, waits for that turn, then sends `/exit` and closes the cmux tab. If the turn ends on a question or leaves work behind, the chat stays open with a note. Closing it again exits without sending the macro. The conversation is kept, so **resume** reopens it in a new cmux workspace.
- The **context bar** under each input fills from green to red as the context window fills, so you can wrap up or fork a chat before Claude Code compacts it.
- **Codex cards** are marked Codex. They reply, stop, approve and deny, rename, close and resume like the rest. They have no subagents, background sessions or Fork, and a Codex dialog other than a command approval has to be answered in its terminal. A Codex chat renamed while closed gets a line in `~/.codex/session_index.jsonl`, where Codex's own `/rename` writes.
- Links to files in a reply, and paths written bare like `./content/post.md` or `app/root.tsx:12`, open in seamux's own viewer, highlighted, with rendered markdown and HTML, and it reloads while the file changes. The header's list button numbers the lines of a raw file, and the choice is remembered. A link to `app/root.tsx:12` opens the file raw, scrolled to line 12 and marked. A path into a worktree that has since been removed opens the same file in the checkout it was made from.

### Dispatching

The **dispatch bar** at the top starts a new top-level session in a chosen directory, with the chosen agent, optionally in a new worktree, with your prompt wrapped in the new-session macro. seamux makes that worktree itself, branched from what the directory has checked out, and puts it in the repo's main checkout even when the directory is itself a worktree, so worktrees never nest: under `.claude/worktrees/` if the repo has one, otherwise under `worktrees/`. A repo with neither `.claude/worktrees/` nor an ignored `worktrees/` has no worktree convention, so the session also gets the How to worktree macro. Starting new work in its own session is the point: that's cheaper than piling another goal into a chat that's already running.

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
