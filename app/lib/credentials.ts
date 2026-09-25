// The board's HTTP Basic credentials: SEAMUX_USER and SEAMUX_PASS from the
// environment, else from the checkout's gitignored .env. Both must be set;
// with either missing the board runs unsecured and says so.
//
// Read on every call rather than once at startup, so editing .env takes
// effect without restarting the board.
//
// scripts/supervise.ts imports this under plain Node, so it uses node:
// builtins only.

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export interface Credentials {
  user: string;
  pass: string;
}

// Each named variable from the environment, else from `dir`'s .env.
export function readEnv<K extends string>(
  dir: string,
  names: readonly K[],
): Record<K, string | undefined> {
  let file: Record<string, string | undefined> = {};
  try {
    file = parseEnv(readFileSync(join(dir, ".env"), "utf8"));
  } catch {}
  return Object.fromEntries(
    names.map((name) => [name, process.env[name] || file[name] || undefined]),
  ) as Record<K, string | undefined>;
}

// The SEAMUX_ variables the dev server's own environment set, kept on
// globalThis so it outlives Vite's restarts, which evaluate vite.config.ts
// again in the same process.
const SHELL_ENV = Symbol.for("seamux.shellEnv");

// React Router's dev server copies .env into process.env when it starts, and
// again when Vite restarts over a changed .env, but never deletes a variable,
// so one removed from .env would stay set and readEnv would still find it.
// vite.config.ts calls this before React Router loads .env: the first time it
// notes which SEAMUX_ variables the environment really set, and every time it
// clears the rest, so what's left is the environment plus the current .env.
export function forgetDotenv() {
  const store = globalThis as { [SHELL_ENV]?: Set<string> };
  const shell = (store[SHELL_ENV] ??= new Set(
    Object.keys(process.env).filter((name) => name.startsWith("SEAMUX_")),
  ));
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("SEAMUX_") && !shell.has(name)) delete process.env[name];
  }
}

export function readCredentials(dir: string): Credentials | null {
  const env = readEnv(dir, ["SEAMUX_USER", "SEAMUX_PASS"]);
  const user = env.SEAMUX_USER;
  const pass = env.SEAMUX_PASS;
  return user && pass ? { user, pass } : null;
}

export function basicAuthHeader({ user, pass }: Credentials): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

// Compare digests, so neither the length nor the content of the expected
// header leaks through timing.
export function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
