---
"seamux": minor
---

Every session seamux starts in a new worktree now gets the How to worktree macro, not only one in a repo with no `.claude/worktrees/` or ignored `worktrees/`. By default it has the session follow the worktree convention in the repo's CLAUDE.md or AGENTS.md, and, when there is none, propose one to you before starting: worktrees in the directory seamux used and gitignored, each starting from the latest main unless told otherwise, dependencies installed in the worktree, all work done there. Once you agree, the session records it in the repo's agent instructions, so later sessions follow it without asking. The macro has a new `{{worktrees}}` variable, the worktree directory relative to the main checkout. If you customised How to worktree, it is now sent for every new worktree, so check it still reads right there.
