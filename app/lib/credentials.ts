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
