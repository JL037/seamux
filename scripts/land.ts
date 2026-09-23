// Lands a branch on main in this checkout, which the running board serves.
//
//   npm run land -- <branch>
//
// 1. Rebases the branch onto main in its own worktree, so main only ever
//    fast-forwards. A conflict stops here, with main untouched.
// 2. Typechecks the rebased branch in its worktree.
// 3. Fast-forwards main. The board picks the change up by hot reload.
// 4. If dependencies changed, reinstalls them and restarts the board.
// 5. Checks the board still answers.
//
// It never deletes the branch or its worktree.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { restart } from "./service.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOARD = "http://127.0.0.1:5173/";

function run(cwd: string, cmd: string, ...args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();
}

function git(cwd: string, ...args: string[]) {
  return run(cwd, "git", ...args);
}

function step(message: string) {
  console.log(`\n→ ${message}`);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\nmain is unchanged.`);
  process.exit(1);
}

function worktreeFor(branch: string): string | null {
  const list = git(REPO, "worktree", "list", "--porcelain");
  for (const block of list.split("\n\n")) {
    const lines = block.split("\n");
    if (lines.includes(`branch refs/heads/${branch}`)) {
      return lines[0].replace(/^worktree /, "");
    }
  }
  return null;
}

// Tracked changes only; untracked files do not block a fast-forward.
function isClean(cwd: string): boolean {
  return git(cwd, "status", "--porcelain", "--untracked-files=no") === "";
}

async function boardAnswers(): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    try {
      if ((await fetch(BOARD)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const branch = process.argv[2];
  if (!branch) fail("usage: npm run land -- <branch>");

  if (git(REPO, "branch", "--show-current") !== "main") {
    fail(`${REPO} must be on main: it is what the board serves.`);
  }
  if (!isClean(REPO)) fail(`${REPO} has uncommitted changes.`);

  const worktree = worktreeFor(branch);
  if (worktree) {
    if (!isClean(worktree)) fail(`${worktree} has uncommitted changes.`);
    step(`Rebasing ${branch} onto main in ${worktree}`);
    try {
      git(worktree, "rebase", "main");
    } catch {
      git(worktree, "rebase", "--abort");
      fail(
        `${branch} conflicts with main. Rebase it by hand in ${worktree}, then land again.`,
      );
    }

    step("Typechecking");
    if (!existsSync(join(worktree, "node_modules"))) {
      run(worktree, "npm", "ci", "--no-audit", "--no-fund");
    }
    try {
      run(worktree, "npm", "run", "typecheck");
    } catch (err) {
      console.error((err as { stdout?: string }).stdout ?? "");
      fail(`${branch} does not typecheck.`);
    }
  }

  const before = git(REPO, "rev-parse", "HEAD");
  step(`Fast-forwarding main to ${branch}`);
  try {
    git(REPO, "merge", "--ff-only", branch);
  } catch {
    fail(
      `${branch} is not a fast-forward of main${worktree ? "" : " (no worktree to rebase it in)"}.`,
    );
  }
  const after = git(REPO, "rev-parse", "HEAD");
  if (before === after) {
    console.log("\nNothing to land: main already contains it.");
    return;
  }

  const depsChanged =
    git(
      REPO,
      "diff",
      "--name-only",
      before,
      after,
      "--",
      "package.json",
      "package-lock.json",
    ) !== "";
  if (depsChanged) {
    step("Dependencies changed: reinstalling and restarting the board");
    run(REPO, "npm", "ci", "--no-audit", "--no-fund");
    try {
      restart();
    } catch {
      console.log(
        "  The board service is not installed; restart the board yourself.",
      );
    }
  }

  step("Checking the board");
  const ok = await boardAnswers();
  console.log(
    `\n${ok ? "✓" : "✗"} Landed ${before.slice(0, 7)}..${after.slice(0, 7)} on main.` +
      (ok
        ? ""
        : ` The board is not answering at ${BOARD}; see data/logs/board.log.`) +
      `\nTo undo: git revert ${before.slice(0, 7)}..${after.slice(0, 7)}`,
  );
  if (!ok) process.exit(1);
}

await main();
