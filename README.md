# seemux

**A root repo you open a Claude Code session in, which spawns and tracks all the other sessions, and serves a board over them.**

Status: all five phases are built and in daily use for feedback. This document is the brief.

Every capability claim below was probed against the running tools on 2026-09-23 rather than taken from documentation. Where something is marked `documented`, it comes from published docs and has not been run yet.

![Board sketch](docs/board-sketch.png)

Jakob's sketch, 2026-09-23. It settles several things the research left open, and it is more ambitious than the earlier draft of this brief assumed.

## If you are picking this up cold

**All five phases are built**, in `~/code/seemux`, and the board is in daily use so Jakob can give feedback on it. Read **Running it** first, then **Findings while building**, which records every place the build corrected the research. The rest of this document is the design those phases implement.

Re-verify the foundation in under a minute if you want to trust it yourself:

```bash
claude agents --json --all                       # session state, the columns
claude --help | sed -n '/^Commands:/,$p'         # spawn, attach, logs, stop, rm, respawn
cmux capabilities                                # terminal.input.ordered.v1, events.v1, todo.v1
cmux rpc workspace.status.get '{}'               # inferred / override / effective + signals
cmux events --snapshot                           # the live stream's subscription shape
ls ~/.claude/projects/*/                         # per-session transcripts, JSONL
```

Four hard constraints, each of which exists for a reason stated below:

1. **Never destroy.** No `claude rm`, no `git worktree remove`, no timer that deletes. Cleanup is a prompt sent into the owning session, which is a whole section further down.
2. **Bind to localhost.** This spawns processes and injects text into live sessions. It stays on `127.0.0.1` until somebody decides otherwise on purpose.
3. **Do not rebuild the CLI surface.** Spawn, list, read, enter, drive, pause and reconcile all exist as commands today. The table below says which. Wrapping them is the job; reimplementing them is not.
4. **`claude agents --json` owns the columns.** cmux is blind to background sessions, measured and explained below, so its status cannot drive them. The transcript is the check on `busy`, for reasons in the findings.

## Running it

```bash
npm run setup    # install dependencies, the subagent hooks, and the dispatch skill
npm run board    # build and serve the board on http://127.0.0.1:4173
npm run dev      # or: the dev server on http://127.0.0.1:5173, reloading on edit
```

`setup` writes to two places outside the repo, both idempotent and both reversible:

- **`~/.claude/settings.json`** gains `SubagentStart` and `SubagentStop` hooks that run `hooks/subagent-event.ts`. It backs the file up first. `npm run hooks:uninstall` removes exactly its own entries.
- **`~/.claude/skills/seemux-dispatch/`** holds the protocol skill, rendered with this checkout's `bin/seemux` path. `npm run skills:uninstall` removes it, and never removes a skill it did not write.

Keep the board running in its own cmux workspace. It needs no restart when sessions come and go, since every poll re-derives the board from the tools.

The store is SQLite at `data/seemux.db`, and fan-out files live in `data/dispatches/`. Both are gitignored, and deleting them loses only subagent history, card intents and fan-out records, never a session.

This README is the brief and its own source of truth: edit it here. Prose in this repo is checked with Taskless.

## The problem, in Jakob's words

> My Taskless sessions are getting complex with worktrees and subagents. Messages arrive out of order, require massive context switches.

> If a channel spawns subagents we end up with muddled messages where everything is arriving out of order and the "parent" agent gets awfully confused.

> These are chats, but things progress from stage to stage and there's no good way to drive the work beyond a single chatbox.

> One mistake I've made in the past is asking a single agent to use worktrees/subagents to solve multiple problems when each one should be its own session.

## What already exists, so we do not rebuild it

| Need | Already provided by | Verified |
| --- | --- | --- |
| Session state and columns | `claude agents --json --all` gives `blocked` / `working` / `done` / `failed` plus `idle` / `busy`, across every project | yes |
| Spawn | `claude --bg`, prints a short id | yes |
| Read without entering | `claude logs <id>` | yes |
| Enter | `claude attach <id>` | yes |
| Pause, keeping history | `claude stop <id>` | yes |
| Drive from outside | `cmux rpc terminal.paste` then `surface.send_key enter`, into the session's surface. Paste arrives bracketed, so newlines stay inside one message; `cmux send` turns `\n` into Enter and would submit a multi-line message in pieces | yes |
| Find a session's surface | `cmux sessions list --json` maps `session_id` to `surface_id` and `workspace_id` | yes |
| Interrupt a turn | `surface.send_key escape`, the same as pressing Esc | yes |
| Lifecycle vocabulary | `workspace.status.*`: `todo` / `working` / `needs-attention` / `review` / `done` / `auto` | yes |
| Operator reconciliation | `workspace.status` carries `inferred`, `override`, `effective` | yes |
| Live event stream | `cmux events --after <seq> --cursor-file <path> --reconnect` | yes |
| New session in a workspace | `workspace.create` with `cwd` and `initial_command`. It silently ignores `command` | yes |
| Worktree creation | `claude --worktree <name>`, at spawn | yes |
| Splitting a tangent out | `claude --resume <id> --fork-session --session-id <new>`, which copies the whole context into a new session and leaves the parent alone. `cmux fork` was not needed | yes |

**The board is largely a UI over commands that ship today**, which is the useful finding here, and it means the build is small if we resist rewriting any of the above.

## The gaps that are actually ours

**Subagent visibility** is the first, and nothing in the field has it. `is_subagent` is `0` on all 14,393 rows of cmux's journal, and `claude agents` treats a session as one row. During the 272-firm sweep Jakob's vault ran 14 subagents inside one session, and every tool available would have shown a single calm card.

Closable two ways. **`SubagentStart`** and **`SubagentStop`** hooks carry `agent_id`, `agent_type` and `session_id`, with `last_assistant_message` on stop, and tool events fired inside a subagent carry `agent_id` too. Verified: this is what seemux uses. Separately, **`--forward-subagent-text`** emits subagent messages with `parent_tool_use_id` set when a session runs in `--print` with `--output-format stream-json`.

**The coordination protocol** is the second. The parent's confusion is a concurrency problem and the mitigations are mechanical, set out below.

**cmux's status cannot own the columns**, which is the third. Measured: the CLI monorepo workspace holds a background session that `claude agents` reports as `blocked`, while `cmux workspace.status.get` reports `effective: todo` with `any_agent_needs_input: false`. cmux derives status from surfaces it hosts, so a background session is invisible to it. It is blind rather than flaky.

**A web surface** is the fourth, since everything above is local CLI or a Mac app.

## Architecture

### The seemux repo

The simplest possible git repo, opened as a Claude Code session. It is the thing you talk to, and it holds:

- **Skills** for the actions: spawn a session, list the board, fork a tangent out, dispatch a fan-out set.
- **The web server** serving the board.
- **The state store** (SQLite).
- **Hook scripts** that sessions install, which report subagent lifecycle back to the store.
- **The protocol helpers** that workers use to write completion markers.

Being a Claude Code session itself is the point. You can talk to the dispatcher in the same way you talk to everything else, and the board is a second view onto what it knows rather than a separate application.

### State management

The rule is **never store what can be re-derived.** Two tiers:

**Derived, and never written to the store:** session state, liveness, workspace placement, git status. Poll `claude agents --json`, stream `cmux events`. If the store disagrees with the tools, the tools win.

**Durable, because nothing else holds it:**

| State | Why it cannot be derived |
| --- | --- |
| Card intent | The goal a session was spawned for. `claude agents` knows only that a session exists |
| Dispatch record | Which parent spawned it, from what prompt, at what checkpoint |
| Stage override | The human's correction when inference is wrong |
| Work log | The durable cross-session record, which survives a session being disposed |
| Subagent tree | Only exists in hook events, nowhere else |
| Dependencies | Which cards gate which |

### The board, from the sketch

Four columns: **IDLE**, **WAITING**, **WORKING**, **DONE**. Simpler than the union of what the tools report, and better, because each column answers a different question about Jakob's attention.

| Column | Means | Derived from |
| --- | --- | --- |
| IDLE | Alive, holding its worktree, nothing to do | `claude agents` `status: idle` with no block |
| WAITING | Blocked on a human | `claude agents` `state: blocked` or `state: failed`, cmux `any_agent_needs_input`, `agent.approval.requested` / `agent.question.requested` |
| WORKING | Running | `status: busy` when the transcript agrees a turn is in progress, or any of its subagents still running |
| DONE | Closed by Jakob | `claude stop`, or the chat closing |

**A failed session needs Jakob**, so it lands in WAITING rather than DONE. Jakob, 2026-09-23: *"A failed session is probably blocked/waiting."*

**Background sessions are not cards.** A background session belongs to the chat that spawned it, and Jakob never drives one directly, so the board shows only that it exists, as a marker on its parent's card. Every piece of dispatched work is a new top-level session, which is what gets a card. Jakob, 2026-09-23: *"backgound sessions have a parent. Those are just part of the main chat (mainly that they exist)... Every piece of dispatched \"Work\" is a new top level agent."*

**DONE is entered by a human closing the chat**, which is the distinction that separates it from IDLE. A session that finishes its turn and has nothing left to do is **IDLE**: alive, holding its worktree, ready for more work. It becomes **DONE** when Jakob closes it. Jakob, 2026-09-23: *"when I close a chat, it's done."*

From there it decays on two timers, and both are display rules:

| Age | Shown | Session itself |
| --- | --- | --- |
| 0 to 30m | Card visible in DONE with a play / resume button | Stopped, conversation kept |
| 30m to 24h | Off the board, still reachable by search or direct link | Unchanged |
| Over 24h | Not rendered anywhere in the UI | Unchanged |

Jakob, 2026-09-23: *"disposal isn't needed fwiw. I think done > 24hr just means not visible at all in our ui."*

**So the dispatcher never deletes anything**, because both timers govern rendering and nothing governs the session's existence. A 25-hour-old session still exists, still has its worktree, and still appears in `claude agents --all`. The dispatcher has simply stopped drawing it. Cleaning up is Jakob's job with `claude rm`, on his own schedule, with his own judgement about uncommitted work.

That gives the system a property worth stating outright: **the dispatcher reads, spawns and drives, and never destroys.** No worktree is removed by a timer, no session is deleted, no history is discarded. Where a worktree genuinely should go, the dispatcher asks the session to do it, which is the next section. The worst a bug can do is show the wrong card or send input to the wrong session, and neither loses work. It also means the 24 hour number is cheap to get wrong, since changing it changes a query rather than a retention policy.

### Rendering and driving a card

Both halves are available today.

**Reading a conversation:** transcripts are JSONL at `~/.claude/projects/<project-slug>/<session-id>.jsonl`, one file per session. That is the card's content. `claude logs <id>` gives recent terminal output for a cheaper preview.

**Writing into a conversation:** a paste into the session's cmux surface, then Enter. `claude -p --resume <session-id>` looked like the path, but on a live session it starts a second process on the same conversation, so seemux never uses it on anything live. A closed chat is resumed in a new cmux workspace instead, so that it becomes live and drivable again.

### Cleanup is a prompt the session acts on

Deleting a worktree is real work that sometimes needs doing, and the dispatcher still should not do it. Jakob, 2026-09-23: *"deleting probably has a cleanup prompt. Something like 'remove your worktree and clean up after yourself. There may be other agents still working in this directory you're not aware of'."*

So cleanup is **a message sent into the session**, using the same reply path as every other write: a paste into the session's cmux surface. The dispatcher gains no destructive capability, and the agent that owns the worktree is the one deciding what is safe to remove, with its own knowledge of which changes are already committed.

**The dispatcher's contribution is the part the agent cannot see**, since a session knows its own cwd and its own commits. It has no idea that two other sessions are live under the same repo. The dispatcher knows exactly that, from `claude agents --json`, so the prompt should carry the facts rather than a generic caution:

```
Clean up after yourself and remove your worktree.

Before you do: there are 2 other sessions live under
/Users/jakob/code/taskless/cli right now (worktrees
claude-md-archive and fix/comparator-top-alignment).
Do not touch anything outside your own worktree, and do
not run a bare `git worktree prune` or anything that
operates on the whole repo.

If you have uncommitted work, say so and stop rather
than discarding it.
```

Three hazards that prompt is written against, all of which are real in this setup today:

- **Uncommitted work in the worktree**, which the agent can check while the dispatcher cannot.
- **Sibling worktrees on the same repo**, where a repo-wide command reaches outside the caller's own directory.
- **Another session sharing the same cwd**, which `claude agents --json` makes visible by grouping on `cwd`.

The result is worth keeping as a rule for the whole system: **when an action is destructive, the dispatcher asks the session to do it and supplies the cross-session context, rather than doing it itself.** The dispatcher's own verbs stay read, spawn and send.

Closing a chat maps to `claude stop <id>`, whose own help says "its conversation is kept: `claude attach <id>` opens it again". That is the resume path behind the play button, and it stays available indefinitely.

**Every card is a live chat with its own input**, which is the central decision and the answer to "no good way to drive the work beyond a single chatbox". A card is not a summary that links back to a terminal, it is the conversation, rendered, with a text box at the bottom. Fourteen cards means fourteen chat boxes on one screen.

Controls differ by column, and the sketch is specific:

- **WORKING** cards carry a **stop** button.
- **DONE** cards carry a **play / resume** button.
- An expanded card shows the transcript with an **input** field beneath it.

**DISPATCH NEW WORK is the primary action**, a full-width bar above the columns with a **directory picker** beside it. Putting it there fixes the cost asymmetry, since the most prominent control on the screen starts a new session in a chosen directory, and spawning one becomes visibly cheaper than cramming another goal into an existing session.

A strip above it holds configuration links.

### Subagents come free when the dispatcher owns the session

`--forward-subagent-text` forwards subagent text and thinking blocks as messages **with `parent_tool_use_id` set**, in `--print` plus `--output-format stream-json` mode. So a session the dispatcher started in stream mode reports its own subagent tree, correlated to the parent tool call, with no hooks at all.

That resolves the own-versus-adopt question into two tiers rather than a choice:

- **Owned sessions** are spawned by the dispatcher in stream mode and give full subagent fidelity from the stream.
- **Adopted sessions** are started by hand in cmux and fall back to `SubagentStart` and `SubagentStop` hooks, which give the tree without the inline text.

Both work. Owning is better, and adopting is not a dead end, so the dispatcher can adopt from day one without painting itself into a corner.

**As built, there is one tier.** Sessions seemux starts are interactive sessions in cmux like any other, because Jakob drives them from the board and from the terminal alike, and stream mode would give up the terminal. So the hooks cover every session, owned or adopted. The stream tier remains available if inline subagent text becomes worth the trade.

### The coordination protocol

The part nobody else is building, and the reason the parent gets confused.

1. **A dispatch is a declared set**, so the parent writes a manifest with a dispatch id and the list of expected workers before spawning anything.
2. **Completion is a marker rather than file existence.** A worker writes its output, then atomically writes a `.done` marker carrying its correlation id and a result summary. During the 272-firm sweep the merge parsed `batch-07.md` before its worker had reported, purely because the file existed. It happened to be complete.
3. **The parent waits on a barrier.** It polls for the marker set rather than reacting to each handback as it lands. `PostToolBatch` fires after a full batch of parallel tool calls resolves and is worth evaluating as the native primitive.
4. **Handbacks are structured and keyed by correlation id.** All 14 prose reports each announcing their own batch number is a parsing problem the parent should not have.
5. **Merges are idempotent and honour a protected list.** That sweep survived its own early-parse bug only because re-running was safe and hand-authored entries were protected.
6. **Cursors are monotonic sequences.** cmux's `sequence` column, and `cmux events --cursor-file`.

**As built:** `bin/seemux fanout` writes the manifest, then spawns each worker as a top-level session with reporting instructions appended to its prompt. `bin/seemux done` writes `<worker>.done.json` by temp file and rename, and refuses a worker the manifest did not declare. `bin/seemux wait` is the barrier: run in the background, it exits once, when every worker has reported, and prints all handbacks keyed by worker. `PostToolBatch` was not needed, since a background command's exit already notifies the parent exactly once. Points 5 and 6 live in the skill's merge guidance rather than in code, because only the parent knows what its merge target is.

### Web surface

Reads from `claude agents --json`, `cmux sessions list`, cmux workspace status, the transcripts and the store, polled every 3 seconds while the tab is visible. Writes through cmux: paste and Enter to reply, Esc to stop, and `workspace.create` to resume, dispatch and fork. Every card names its cmux workspace, so the board never becomes the only way in.

Every write checks that the request's Host is local and its Origin matches it. A browser lets any website POST a form to `127.0.0.1`, so without that check any page Jakob visited could type into his sessions.

**Auth is an open question the moment this leaves localhost**, because it can spawn processes and send input to live sessions, so the threat model is real. Phase 1 should bind to localhost and stay there.

## Phasing

All five are built, each as one commit on seemux's `phase-1-board` branch.

**Phase 1, read-only board**, being `claude agents --json` plus cmux enrichment served locally. Built as planned, plus a popout modal per card with the full conversation.

**Phase 2, subagent visibility**, via `SubagentStart` and `SubagentStop` hooks writing to the store. Built. A card whose subagents are running sits in WORKING even when the parent is idle, which is the calm-card problem from the 272-firm sweep, fixed.

**Phase 3, drive from the board**: reply, stop, and resume. Never `claude rm`. The status override was left out, until the columns get something wrong in daily use.

**Phase 4, spawn**: the dispatch bar starts a new session with a directory, an optional worktree and a first prompt, and fork splits a tangent out of any chat. Each records its intent, which the card shows.

**Phase 5, the protocol**: manifests, completion markers and a barrier, as `bin/seemux` and the `seemux-dispatch` skill. The board shows each fan-out set and which workers have reported.

## Decisions

Settled by Jakob, 2026-09-23.

**Internal tool**, rather than a Taskless product. So there is no onboarding, no multi-user, no packaging, and no need to generalise past one setup: Claude Code plus cmux on macOS. Hard-code the conventions. The subagent layer and the coordination protocol are still the valuable parts, now because they fix a daily problem rather than because they are defensible.

**One Mac**, so there is no sync layer, no device identity and no push. Reading local files directly is fine, including `~/.claude/projects/<slug>/*.jsonl` and the cmux socket. Bind the server to localhost.

One consequence worth keeping in view: *one host* and *localhost-only* are different claims. The moment a phone on the same network opens the board, the binding changes and the auth question returns, because this thing can spawn processes and inject text into live sessions. Staying on `127.0.0.1` keeps that closed. Reaching it from a phone should be an explicit later decision with its own answer, rather than a config change made in a hurry.

**The remote surface is chats, arranged as a kanban board**, so the earlier framing of "board or chat" was a false choice. A card *is* a conversation, and the columns are a layout over those conversations rather than a separate summary view. This is what the sketch already showed, and it is the whole answer to driving work beyond a single chatbox: the board is N chat windows, grouped by what each one needs from Jakob.

## Findings while building

Each of these corrected something the research had marked verified or documented. They are listed because the next reader would otherwise trust the older claim.

- **`status: busy` does not mean a turn is running.** Claude Code also sets it while internal helper agents run between turns, and while a background shell runs after the turn has ended. The board treats a session as working only when the transcript's last message agrees: a turn is over once the last message is an assistant message with `stop_reason: end_turn`, an interruption, or a harness-written turn such as `/compact`.
- **Helper agents fire `SubagentStop` with an empty `agent_type` and never fire `SubagentStart`.** The hook ignores them. Counting them showed three subagents where there was one.
- **Claude Code records subagents on disk.** Each session's transcript directory holds `subagents/agent-<id>.jsonl` and `agent-<id>.meta.json`, with the description, type, parent tool call and spawn depth. The research's "nothing has it" held for cmux and `claude agents`, but not for the transcripts. The board reads descriptions from there rather than storing them.
- **`workspace.create` ignores `command`.** The field is `initial_command`, run through `zsh -lc`.
- **That login shell does not read `~/.zshrc`**, so neither `claude` nor `node` is on its `PATH`. seemux launches through cmux's own `cmux-claude-wrapper`, which also registers the session with cmux, with `~/.local/bin` and the server's Node directory prepended. Launching `claude` directly starts a session cmux never learns about, which the board then cannot drive.
- **cmux RPCs default to the caller's own surface.** A call without a `surface_id` acts on whatever terminal seemux itself runs in. seemux always resolves the surface server-side and passes it explicitly.
- **A resumed chat is invisible for a few seconds.** Until the new workspace starts Claude, nothing reports the session as live, so a second resume in that window started a second process on the same conversation. The server now claims a session before its first check and holds the claim for 60 seconds.
- **The global hook is required.** A hook fires in the session that starts the subagent, so a hook in seemux's own project settings would only ever see seemux's own subagents.

## What is left open

Nothing blocking. These wait on feedback from daily use:

1. **The status override**, Jakob's correction when a column is wrong. Worth building only once the columns are wrong often enough to matter.
2. **A cleanup button**, sending the cleanup prompt above with the live sibling sessions filled in. The reply box can send it by hand today.
3. **The 30m to 24h tier**: closed chats past 30 minutes are off the board with no search yet.
4. **The work log**, which still has nothing writing to it.
5. **Polling versus `cmux events`**: the board polls every 3 seconds, at about half a second per poll. The event stream would cut both, if polling ever feels slow.
6. **Leaving localhost**, which remains a deliberate later decision with its own auth answer.
