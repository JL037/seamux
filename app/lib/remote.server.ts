// Remote access: a Cloudflare named tunnel from SEAMUX_CF_DOMAIN to the board,
// with Cloudflare Access in front of it.
//
// The Remote tab's switch records whether the tunnel should run, in
// .seamux.json; the supervisor (scripts/supervise.ts) starts and stops
// cloudflared to match. A request through the tunnel must carry a valid
// Access token for SEAMUX_CF_TEAM and SEAMUX_CF_AUD, checked here, and then
// needs no HTTP Basic credentials. If the Access application is ever deleted
// or loosened, the board still refuses.
//
// scripts/supervise.ts and vite.config.ts import this under plain Node, so it
// uses node: builtins and relative imports only.

import {
  createPublicKey,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readEnv } from "./credentials.ts";

// Every variable remote access needs. SEAMUX_CF_TUNNEL is only shown, since
// the token already names the tunnel.
export const REMOTE_ENV = [
  "SEAMUX_CF_TOKEN",
  "SEAMUX_CF_DOMAIN",
  "SEAMUX_CF_TEAM",
  "SEAMUX_CF_AUD",
] as const;

// The header Cloudflare Access adds to every request it lets through.
export const ACCESS_HEADER = "cf-access-jwt-assertion";

export interface RemoteSettings {
  token: string;
  // The tunnel's public hostname, e.g. seamux.example.com.
  domain: string;
  // The Zero Trust team's hostname, e.g. myteam.cloudflareaccess.com.
  team: string;
  // The Access application's audience tag.
  aud: string;
  tunnel: string | null;
}

// What the Remote tab shows. No secrets.
export interface RemoteStatus {
  // The variables still unset; the switch can't turn on until none are.
  missing: string[];
  domain: string | null;
  tunnel: string | null;
  // The switch.
  wanted: boolean;
  // cloudflared's pid, while it runs.
  pid: number | null;
  // Whether a supervisor is running to start it.
  supervised: boolean;
  // Whether this request came through the tunnel.
  viaTunnel: boolean;
}

// The settings, or null with the variables still missing. Read on every
// call, like the Basic credentials, so editing .env needs no restart (except
// for Vite's allowedHosts, which it reads once).
export function readRemoteSettings(dir: string): {
  settings: RemoteSettings | null;
  missing: string[];
} {
  const env = readEnv(dir, [...REMOTE_ENV, "SEAMUX_CF_TUNNEL"]);
  const missing = REMOTE_ENV.filter((name) => !env[name]);
  if (missing.length > 0) return { settings: null, missing };
  return {
    settings: {
      token: env.SEAMUX_CF_TOKEN!,
      domain: hostOf(env.SEAMUX_CF_DOMAIN!),
      team: teamHost(env.SEAMUX_CF_TEAM!),
      aud: env.SEAMUX_CF_AUD!.trim(),
      tunnel: env.SEAMUX_CF_TUNNEL ?? null,
    },
    missing: [],
  };
}

// The tunnel's hostname, once every variable is set: Vite's allowedHosts and
// the board's guard accept it alongside localhost.
export function remoteDomain(dir: string): string | null {
  return readRemoteSettings(dir).settings?.domain ?? null;
}

// A bare hostname from what might be a URL, lowercased and without a port.
function hostOf(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

// A team given as "myteam", "myteam.cloudflareaccess.com" or its URL.
function teamHost(value: string): string {
  const host = hostOf(value);
  return host.includes(".") ? host : `${host}.cloudflareaccess.com`;
}

// --- The switch, kept in .seamux.json beside the port --------------------

function readRunFile(dir: string): Record<string, unknown> {
  try {
    const saved = JSON.parse(readFileSync(join(dir, ".seamux.json"), "utf8"));
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

// Merge `fields` into .seamux.json, keeping whatever else it holds.
export function updateRunFile(dir: string, fields: Record<string, unknown>) {
  writeFileSync(
    join(dir, ".seamux.json"),
    `${JSON.stringify({ ...readRunFile(dir), ...fields }, null, 2)}\n`,
  );
}

export function remoteWanted(dir: string): boolean {
  return readRunFile(dir).remote === true;
}

export function setRemoteWanted(dir: string, on: boolean) {
  updateRunFile(dir, { remote: on });
}

// --- cloudflared's pid, written by the supervisor ------------------------

export function tunnelPidFile(dir: string): string {
  return join(dir, "data", "tunnel.pid");
}

export function tunnelLogFile(dir: string): string {
  return join(dir, "data", "tunnel.log");
}

export function livePid(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function remoteStatus(dir: string, host: string | null): RemoteStatus {
  const { missing } = readRemoteSettings(dir);
  const env = readEnv(dir, ["SEAMUX_CF_DOMAIN", "SEAMUX_CF_TUNNEL"]);
  return {
    missing,
    domain: env.SEAMUX_CF_DOMAIN ? hostOf(env.SEAMUX_CF_DOMAIN) : null,
    tunnel: env.SEAMUX_CF_TUNNEL ?? null,
    wanted: remoteWanted(dir),
    pid: livePid(tunnelPidFile(dir)),
    supervised: livePid(join(dir, "data", "serve.pid")) !== null,
    viaTunnel: isTunnelHost(dir, host),
  };
}

// --- Requests through the tunnel -----------------------------------------

export function isTunnelHost(dir: string, host: string | null): boolean {
  const domain = remoteDomain(dir);
  return domain !== null && host !== null && hostOf(host) === domain;
}

export type TunnelVerdict =
  | { verdict: "local" }
  | { verdict: "allowed" }
  | { verdict: "denied"; reason: string };

// "local" for a request that didn't come through the tunnel; otherwise
// whether its Access token checks out, and if not, why.
export async function checkTunnelRequest(
  dir: string,
  host: string | null,
  token: string | null,
): Promise<TunnelVerdict> {
  const { settings } = readRemoteSettings(dir);
  if (!settings || host === null || hostOf(host) !== settings.domain) {
    return { verdict: "local" };
  }
  const checked = token
    ? await verifyAccessToken(token, settings)
    : { reason: "it carried no Cloudflare Access token" };
  if ("claims" in checked) return { verdict: "allowed" };
  console.warn(`[seamux] refused a request through the tunnel: ${checked.reason}`);
  return { verdict: "denied", reason: checked.reason };
}

// The 403 for a refused tunnel request, and why.
export function forbiddenPage(reason: string): string {
  const escaped = reason.replace(
    /[&<>"']/g,
    (c) => `&#${c.charCodeAt(0)};`,
  );
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>seamux: forbidden</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}</style>
<h1>Forbidden</h1>
<p>seamux refused this request because ${escaped}.</p>
<p>If Cloudflare Access let you in, check SEAMUX_CF_TEAM and SEAMUX_CF_AUD in the board's .env against the Access application.</p>
`;
}

// Leeway for the clock on either side.
const SKEW_S = 60;

export interface AccessClaims {
  iss?: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  email?: string;
}

// Checks a Cloudflare Access JWT: RS256, signed by one of the team's keys,
// for this application, and in date. The issuer isn't checked: a renamed
// team keeps issuing under its old name, and the team's key and the
// application's AUD already rule out any other team or app. The reason for a
// refusal finishes "seamux refused this request because …".
export async function verifyAccessToken(
  token: string,
  { team, aud }: { team: string; aud: string },
): Promise<{ claims: AccessClaims } | { reason: string }> {
  const malformed = { reason: "its Access token is malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return malformed;
  const [head, body, signature] = parts;
  let header: { alg?: unknown; kid?: unknown };
  let claims: AccessClaims;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return malformed;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    return malformed;
  }
  const key = await accessKey(team, header.kid);
  if (!key) {
    return {
      reason: `its Access token isn't signed by any key of ${team}, the team in SEAMUX_CF_TEAM`,
    };
  }
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    key,
    Buffer.from(signature, "base64url"),
  );
  if (!signed) return { reason: "its Access token's signature is invalid" };
  // Signed by the team, so the claims below can be named in the reason.
  const now = Date.now() / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) {
    return {
      reason:
        "its Access login is for a different application from the one in SEAMUX_CF_AUD",
    };
  }
  if (typeof claims.exp !== "number" || claims.exp < now - SKEW_S) {
    return { reason: "its Access login has expired" };
  }
  if (typeof claims.nbf === "number" && claims.nbf > now + SKEW_S) {
    return { reason: "its Access login isn't valid yet" };
  }
  return { claims };
}

// The team's signing keys, from its certs endpoint. Kept for an hour, and
// fetched again early for a key id it doesn't know, at most every 30s, since
// Cloudflare rotates them.
const KEYS_FRESH_MS = 60 * 60_000;
const REFETCH_AFTER_MS = 30_000;
const keyCache = new Map<
  string,
  { at: number; keys: Map<string, KeyObject> }
>();
const inFlight = new Map<string, Promise<Map<string, KeyObject> | null>>();

async function accessKey(
  team: string,
  kid: string,
): Promise<KeyObject | undefined> {
  const cached = keyCache.get(team);
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < KEYS_FRESH_MS) {
    if (cached.keys.has(kid) || age < REFETCH_AFTER_MS) {
      return cached.keys.get(kid);
    }
  }
  let pending = inFlight.get(team);
  if (!pending) {
    pending = fetchKeys(team).finally(() => inFlight.delete(team));
    inFlight.set(team, pending);
  }
  const keys = await pending;
  if (keys) keyCache.set(team, { at: Date.now(), keys });
  return (keys ?? cached?.keys)?.get(kid);
}

async function fetchKeys(team: string): Promise<Map<string, KeyObject> | null> {
  try {
    const res = await fetch(`https://${team}/cdn-cgi/access/certs`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const { keys } = (await res.json()) as {
      keys?: (JsonWebKey & { kid?: string })[];
    };
    const map = new Map<string, KeyObject>();
    for (const jwk of keys ?? []) {
      if (jwk.kid)
        map.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
    }
    return map;
  } catch {
    return null;
  }
}
