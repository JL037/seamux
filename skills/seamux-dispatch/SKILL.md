---
name: seamux-dispatch
description: Split work into independent pieces that each run as their own top-level Claude session, then collect every result at once. Use when a task divides into parts that can proceed in parallel (a sweep over many items, several unrelated fixes, research across separate sources), instead of running them as subagents or worktrees inside this one session. Also use when asked to "dispatch", "fan out", or "split this into sessions".
---

# seamux dispatch

Each piece of work gets its own top-level session, visible and drivable on the seamux board. You declare the whole set first, spawn it, then wait on a barrier that returns every handback at once, keyed by worker. You never react to results one at a time as they arrive.

The CLI is `{{SEAMUX_BIN}}`.

## When to use it

Use it when the pieces are independent: no piece needs another's output to start. If a piece is small enough to finish in a few tool calls, do it yourself instead. If pieces depend on each other, dispatch the first stage, wait, then dispatch the next.

## 1. Declare the set

Write a manifest. Every worker needs a key (lowercase, digits, `-`, `_`), an absolute `cwd` (or one starting `~/`), and a self-contained prompt: the worker starts with none of your context, so say exactly what to do and where to write its output. Give each worker its own output path, so no two workers write the same file.

```json
{
  "title": "Classify firms, batches 1-3",
  "workers": [
    { "key": "batch-01", "cwd": "~/project", "prompt": "Classify the firms in inbox/batch-01.md ... Write results to out/batch-01.md." },
    { "key": "batch-02", "cwd": "~/project", "prompt": "..." },
    { "key": "batch-03", "cwd": "~/project", "prompt": "...", "worktree": true }
  ]
}
```

Set `"worktree": true` for a worker that edits a git repo alongside other workers in the same repo, so each gets its own worktree.

## 2. Spawn it

```bash
{{SEAMUX_BIN}} fanout manifest.json
```

It writes the manifest before spawning anything, starts each worker as its own session with instructions for reporting back, and prints the dispatch id.

## 3. Wait on the barrier

Run the wait **in the background**, so you are notified once, when every worker has reported or its session has ended:

```bash
{{SEAMUX_BIN}} wait <dispatch-id>
```

It exits 0 once no worker is left to wait for, and 2 on timeout (default one hour, `--timeout <seconds>`), printing JSON either way:

```json
{ "complete": true, "pending": [], "gone": ["batch-03"], "failed": ["batch-02"],
  "handbacks": { "batch-01": { "status": "ok", "summary": "...", "result": "out/batch-01.md" }, ... } }
```

A worker in `gone` had its session closed without reporting, so it has no handback and never will. A worker is never counted gone in the first few minutes after `fanout` starts it, while its session may not show yet.

Check progress without blocking with `{{SEAMUX_BIN}} status <dispatch-id>`.

## 4. Merge

- Read results only from workers whose handback says `ok`. A worker reports only after its outputs are fully written, so a result file existing is never the signal; the handback is.
- Merge by worker key, and make the merge idempotent: running it twice gives the same result. Never overwrite hand-authored entries in the target.
- For a `failed` worker, read its summary, then fix and re-dispatch just that piece as a new, smaller set.
- Treat a `gone` worker's piece as not done: look at what it left behind before trusting any of it, and re-dispatch it if it's needed.

## Worker side

Workers get their reporting instructions appended to their prompt. For reference, a worker reports with:

```bash
{{SEAMUX_BIN}} done <dispatch-id> <worker-key> --summary "<what it did and found>" [--result <path>] [--status failed]
```
