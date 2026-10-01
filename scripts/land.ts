// Lands a branch on main in the main checkout, which the running board
// serves. Run it from a worktree to land that worktree's branch:
//
//   npm run land              (from a worktree: lands its current branch)
//   npm run land -- <branch>  (from anywhere in the repo)
//
// Landings are serialised by a lock, so many agents can land at once: each
// waits its turn, then rebases onto main as it is at that moment.
//
// 1. Fetches origin/main and refuses to land while main lacks any of its
//    commits, such as GitHub's release commit: landing on top of a main
//    that's behind is how local main and GitHub drift apart. A branch that
//    already contains origin/main, such as the push skill's merge of it,
//    lands anyway, since main has everything once it does. Land never merges
//    or pulls by itself; it only fast-forwards main. If the fetch fails, as
//    it does offline, it warns and lands without the check.
// 2. Rebases the branch onto main in its own worktree, so main only ever
//    fast-forwards. A conflict stops here, with main untouched. A branch
//    already on top of main isn't rebased, and one with a merge commit or
//    origin/main's commits never is: a rebase flattens the merge into copies
//    of the commits it brought in, so a merge of origin/main would leave main
//    with copies of GitHub's commits, which it could then never be pushed
//    over.
// 3. Typechecks the rebased branch in its worktree.
// 4. Fast-forwards main. The board picks the change up by hot reload.
// 5. If dependencies changed, reinstalls them and restarts the board. It
//    restarts it too when server modules changed, since hot reload keeps
//    their in-memory state, such as the queue's timer, from before.
// 6. Checks the board still answers.
//
// It never deletes the branch or its worktree.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  boardHeaders,
  boardPid,
  boardUrl,
  requestRestart,
} from "./supervise.ts";

const LOCK_WAIT_MS = 20 * 60 * 1000;

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

// The main checkout is the first entry git lists, from any worktree.
const REPO = git(process.cwd(), "worktree", "list", "--porcelain")
  .split("\n")[0]
  .replace(/^worktree /, "");
const LOCK = join(REPO, "data/land.lock");
const BOARD = boardUrl(REPO);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// mkdir is atomic, so only one lander gets the directory. A lock whose
// owner has died is cleared.
async function acquireLock(branch: string) {
  mkdirSync(join(REPO, "data"), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let announced = false;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(
        join(LOCK, "owner.json"),
        JSON.stringify({ pid: process.pid, branch, at: Date.now() }),
      );
      process.on("exit", () => rmSync(LOCK, { recursive: true, force: true }));
      for (const sig of ["SIGINT", "SIGTERM"] as const) {
        process.on(sig, () => process.exit(130));
      }
      return;
    } catch {}
    let owner: { pid: number; branch: string } | null = null;
    try {
      owner = JSON.parse(readFileSync(join(LOCK, "owner.json"), "utf8"));
    } catch {}
    if (owner && !alive(owner.pid)) {
      rmSync(LOCK, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) fail("Timed out waiting for another landing.");
    if (!announced && owner) {
      step(`Waiting for ${owner.branch} to finish landing`);
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
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

// Whether `commit` is in `of`'s history.
function isAncestor(cwd: string, commit: string, of: string): boolean {
  try {
    git(cwd, "merge-base", "--is-ancestor", commit, of);
    return true;
  } catch {
    return false;
  }
}

// Tracked changes only; untracked files do not block a fast-forward.
function isClean(cwd: string): boolean {
  return git(cwd, "status", "--porcelain", "--untracked-files=no") === "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The supervisor notices a restart request within a second, but until it
// does the old server still answers. Wait for a new dev server's pid, so
// the check below is of the new one.
async function restarted(before: string | null): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const pid = boardPid(REPO);
    if (pid && pid !== before) return;
    await sleep(1000);
  }
}

// A dev server fresh from `npm ci` re-optimizes its dependencies on the
// first request, which has taken longer than 20 seconds.
async function boardAnswers(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BOARD, { headers: boardHeaders(REPO) })).ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function main() {
  const branch =
    process.argv[2] ??
    (process.cwd().startsWith(`${REPO}/`) || process.cwd() === REPO
      ? git(process.cwd(), "branch", "--show-current")
      : "");
  if (!branch || branch === "main") {
    fail(
      "Run this from a worktree, or name the branch: npm run land -- <branch>",
    );
  }

  await acquireLock(branch);

  if (git(REPO, "branch", "--show-current") !== "main") {
    fail(`${REPO} must be on main: it is what the board serves.`);
  }
  if (!isClean(REPO)) fail(`${REPO} has uncommitted changes.`);

  step("Fetching origin/main");
  let fetched = false;
  try {
    execFileSync("git", ["fetch", "origin", "main"], {
      cwd: REPO,
      stdio: ["ignore", "ignore", "pipe"],
    });
    fetched = true;
  } catch {
    console.warn(
      "! Couldn't fetch origin/main, so landing without checking main has everything GitHub has.",
    );
  }
  // Whether the branch carries origin/main's commits, which a rebase would
  // copy. Unknown, and taken as not, when the fetch fails.
  let hasOrigin = false;
  if (fetched) {
    hasOrigin = isAncestor(REPO, "origin/main", branch);
    const missing = git(REPO, "log", "--oneline", "main..origin/main");
    if (missing && !hasOrigin) {
      fail(
        `main is missing commits GitHub has:\n\n${missing}\n\nBring them into main first, as the push skill's step 3 does: in a worktree, merge origin/main into a branch on main (git merge --ff-only main, then git merge --no-edit origin/main) and land that branch. Then land ${branch} again.`,
      );
    }
  }

  const worktree = worktreeFor(branch);
  if (worktree) {
    if (!isClean(worktree)) fail(`${worktree} has uncommitted changes.`);
    if (isAncestor(worktree, "main", "HEAD")) {
      step(`${branch} is already on top of main`);
    } else if (
      hasOrigin ||
      git(worktree, "rev-list", "--merges", "main..HEAD") !== ""
    ) {
      fail(
        `${branch} has ${hasOrigin ? "origin/main's commits" : "a merge commit"} and main has moved since, and a rebase would turn ${hasOrigin ? "them" : "what it merged"} into copies. Merge main into it in ${worktree} (git merge --no-edit main), then land again.`,
      );
    } else {
      step(`Rebasing ${branch} onto main in ${worktree}`);
      try {
        git(worktree, "rebase", "main");
      } catch {
        git(worktree, "rebase", "--abort");
        fail(
          `${branch} conflicts with main. Rebase it by hand in ${worktree}, then land again.`,
        );
      }
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

  const changed = git(REPO, "diff", "--name-only", before, after).split("\n");
  // The lockfile changes whenever dependencies do; package.json alone
  // also changes for scripts, which need no reinstall.
  const depsChanged = changed.includes("package-lock.json");
  // A hot-reloaded server module starts over beside the old one's timers
  // and maps, which then disagree until the board restarts.
  const serverChanged = changed.some((f) => f.endsWith(".server.ts"));
  if (depsChanged) {
    step("Dependencies changed: reinstalling and restarting the board");
    run(REPO, "npm", "ci", "--no-audit", "--no-fund");
  } else if (serverChanged) {
    step("Server modules changed: restarting the board");
  }
  if (depsChanged || serverChanged) {
    // `npm run seamux` picks this up within a second.
    const before = boardPid(REPO);
    requestRestart(REPO);
    await restarted(before);
  }

  step("Checking the board");
  const ok = await boardAnswers();
  console.log(
    `\n${ok ? "✓" : "✗"} Landed ${before.slice(0, 7)}..${after.slice(0, 7)} on main.` +
      (ok
        ? ""
        : ` The board is not answering at ${BOARD}; see the terminal running \`npm run seamux\`.`) +
      `\nTo undo: git revert ${before.slice(0, 7)}..${after.slice(0, 7)}`,
  );
  if (!ok) process.exit(1);
}

await main();
