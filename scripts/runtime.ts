// What sessions run to reach seamux: the subagent hook, and the CLI the
// dispatch skill and fan-out workers call.
//
// A checkout runs both from itself, as TypeScript. An installed package may
// live in an npx cache that is emptied at any time, and Node won't strip
// types under node_modules, so it copies the bundled scripts from dist/ into
// SEAMUX_HOME/bin and points everything there. As .mjs: out there no
// package.json says they are ES modules. The supervisor does that on
// every start, so an upgrade replaces them.

import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  IS_CHECKOUT,
  packagePath,
  SEAMUX_BIN,
  SEAMUX_HOME,
} from "../app/lib/paths.server.ts";

const BIN_DIR = join(SEAMUX_HOME, "bin");

// The hook's script, for `node <it>` in ~/.claude/settings.json.
export const HOOK_SCRIPT = IS_CHECKOUT
  ? packagePath("hooks/subagent-event.ts")
  : join(BIN_DIR, "subagent-event.mjs");

// What goes before `node` in a command sessions run, so the copies find
// this SEAMUX_HOME even when it isn't ~/.seamux: sessions don't have the
// board's environment.
export const HOME_PREFIX = IS_CHECKOUT ? "" : `SEAMUX_HOME='${SEAMUX_HOME}' `;

// Copy the bundled hook and CLI into SEAMUX_HOME/bin, with a bin/seamux that
// runs the CLI on the Node this process runs on. Nothing to do for a
// checkout.
export function installRuntime() {
  if (IS_CHECKOUT) return;
  mkdirSync(BIN_DIR, { recursive: true });
  for (const name of ["seamux", "subagent-event"]) {
    copyFileSync(
      packagePath("dist", `${name}.js`),
      join(BIN_DIR, `${name}.mjs`),
    );
  }
  writeFileSync(
    SEAMUX_BIN,
    `#!/bin/sh\n${HOME_PREFIX}exec '${process.execPath}' --no-warnings '${join(BIN_DIR, "seamux.mjs")}' "$@"\n`,
  );
  chmodSync(SEAMUX_BIN, 0o755);
}
