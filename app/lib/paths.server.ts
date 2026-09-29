// Where seamux is, and where it keeps its state. Imported by the board, the
// scripts, the hook and the compiled server, some of which Node runs
// directly, so it uses node: builtins only.
//
// Run from a git checkout, seamux keeps its state in the checkout, as it
// always has: .env, .seamux.json and data/ at its root. Installed from npm,
// the package directory may be an npx cache that is emptied at any time, so
// the state goes in ~/.seamux instead. SEAMUX_HOME overrides either.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The nearest directory up from this module holding seamux's package.json:
// the same from app/lib/, build/server/ and dist/. null for a copy of a
// bundled script that lives outside the package, such as the hook installed
// under ~/.seamux.
function findPackageRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg?.name === "seamux") return dir;
    } catch {}
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export const PACKAGE_ROOT = findPackageRoot();

// Whether this is a git checkout of seamux (a worktree included), rather
// than an installed package.
export const IS_CHECKOUT =
  PACKAGE_ROOT !== null && existsSync(join(PACKAGE_ROOT, ".git"));

// Holds .env, .seamux.json and data/.
export const SEAMUX_HOME =
  process.env.SEAMUX_HOME ||
  (IS_CHECKOUT && PACKAGE_ROOT ? PACKAGE_ROOT : join(homedir(), ".seamux"));

export const DATA_DIR = join(SEAMUX_HOME, "data");

// The command sessions call to reach seamux: the dispatch skill, and each
// fan-out worker reporting back. A checkout's own bin/seamux; for an
// installed package, the copy the supervisor keeps under SEAMUX_HOME, since
// an npx cache may not outlive the sessions that call it.
export const SEAMUX_BIN =
  IS_CHECKOUT && PACKAGE_ROOT
    ? join(PACKAGE_ROOT, "bin/seamux")
    : join(SEAMUX_HOME, "bin/seamux");

// The package's own files, which a copy outside the package has no use for.
export function packagePath(...parts: string[]): string {
  if (!PACKAGE_ROOT) throw new Error("Not running from the seamux package");
  return join(PACKAGE_ROOT, ...parts);
}

// seamux's version, from its package.json.
export function packageVersion(): string | null {
  try {
    return JSON.parse(readFileSync(packagePath("package.json"), "utf8"))
      .version;
  } catch {
    return null;
  }
}
