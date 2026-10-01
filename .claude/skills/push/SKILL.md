---
name: push
description: Push seamux's local main to GitHub once this worktree's work has landed. Checks the branch is already on main and stops if not, makes sure every user-facing change has a changeset, pulls origin/main in first, resolves conflicts if there are any, then pushes. Use when asked to "push", "push main", or "/push", usually right after landing.
---

# Push main

`npm run land` fast-forwards the local `main` but never pushes it. This pushes it, for collaborators on `thecodedrift/seamux`. Run each step from the current worktree; never edit the main checkout directly, since it is what the board serves.

```sh
REPO=$(git worktree list --porcelain | head -1 | sed 's/^worktree //')   # the main checkout
BRANCH=$(git branch --show-current)
```

## 1. Check this worktree is on main. Stop if not.

- `git status --porcelain --untracked-files=no` must be empty.
- Unless `BRANCH` is `main`, `git merge-base --is-ancestor HEAD main` must succeed, meaning every commit here has landed.

If either fails, **stop**. Tell the user what hasn't landed (`git log --oneline main..HEAD`, or the uncommitted files) and that it needs committing and landing (`npm run land`) first. Do not land it yourself as part of this skill.

## 2. Check the changesets

```sh
git fetch origin main
git log --stat origin/main..main      # what this push would publish
```

Go through those commits against CLAUDE.md's Release notes. A commit needs a changeset when someone running seamux would notice it: a fix, a new or changed feature, setting or command, or a change to where seamux keeps its state. Docs, CI, refactors, tests, and tooling for working on seamux (such as `.claude/skills/`) need none. Many pushes need none; don't add one just to be safe.

A commit is covered when it, or another unpushed commit on the same change, adds or edits a `.changeset/*.md` that describes it. For each noticeable change that isn't covered:

- In a worktree: write the changeset by hand (`patch` or `minor`, never `major`; extend an existing changeset for the same change rather than adding a second), commit it, and `npm run land`. Then continue.
- In the main checkout: stop, and tell the user which change needs one.

Say in a line each which commits you judged noticeable and which not, so the user can overrule you.

## 3. Pull the latest main

```sh
git log --oneline main..origin/main   # what GitHub has that local main lacks
```

- **Nothing listed:** local main already contains origin/main. Skip to step 5.
- **Commits listed:** bring them in on this branch, so a conflict never touches the main checkout:

  ```sh
  git merge --ff-only main            # this branch = main
  git merge --no-edit origin/main
  ```

  If `BRANCH` is `main` (a session running in the main checkout), stop and ask the user instead: merging there edits what the board serves.

## 4. Resolve conflicts, if any

If the merge conflicts, resolve it when the right answer is clear from both sides (`git diff`, and `git log -p` of the commits involved): keep both intents, then `git add` and `git commit --no-edit`. If the right resolution is a judgement call, `git merge --abort` and ask the user; main is still untouched.

Then land the merge, which typechecks it, fast-forwards main, and restarts the board if it needs to:

```sh
npm run land
```

Land never rebases a merge, since that would turn origin's commits into copies that main could never be pushed over. If main moved since the merge, land stops and says so: `git merge --no-edit main` on this branch, and land again.

## 5. Push

```sh
git push origin main
```

This pushes the local `main` ref, whichever worktree it runs from. It only fast-forwards; if GitHub rejects it because origin moved again, go back to step 3. Never force-push.

Report what was pushed: `git log --oneline <old origin/main>..main`, or say main was already up to date.
