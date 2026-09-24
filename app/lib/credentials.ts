// The board's HTTP Basic credentials: SEAMUX_USER and SEAMUX_PASS from the
// environment, else from the checkout's gitignored .env. Both must be set;
// with either missing the board runs unsecured and says so.
//
// Read on every call rather than once at startup, so editing .env takes
// effect without restarting the board.
//
// scripts/supervise.ts imports this under plain Node, so it uses node:
// builtins only.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export interface Credentials {
  user: string;
  pass: string;
}

export function readCredentials(dir: string): Credentials | null {
  let file: Record<string, string | undefined> = {};
  try {
    file = parseEnv(readFileSync(join(dir, ".env"), "utf8"));
  } catch {}
  const user = process.env.SEAMUX_USER ?? file.SEAMUX_USER;
  const pass = process.env.SEAMUX_PASS ?? file.SEAMUX_PASS;
  return user && pass ? { user, pass } : null;
}

export function basicAuthHeader({ user, pass }: Credentials): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}
