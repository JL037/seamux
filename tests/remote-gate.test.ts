// The gate's answer through the tunnel. Cloudflare's edge must store none of
// what the board answers, since it serves what it stored to every browser
// after, whatever the board answers now.

import { mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EDGE_CACHE_HEADER, remoteGate } from "~/lib/remote.server";

const DOMAIN = "board.example.com";

function tunnelHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "seamux-gate-"));
  writeFileSync(
    join(dir, ".env"),
    [
      "SEAMUX_CF_TOKEN=token",
      `SEAMUX_CF_DOMAIN=${DOMAIN}`,
      "SEAMUX_CF_TEAM=team",
      "SEAMUX_CF_AUD=aud",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, ".seamux.json"),
    JSON.stringify({ remote: true, tunnel: true }),
  );
  return dir;
}

function request(host: string) {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    end: () => {},
  };
  const req = { socket: { remoteAddress: "127.0.0.1" }, headers: { host } };
  return { req, res, headers };
}

async function pass(dir: string, host: string) {
  const { req, res, headers } = request(host);
  await new Promise<void>((resolve) => {
    res.end = resolve;
    remoteGate(dir)(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      () => resolve(),
    );
  });
  return { status: res.statusCode, headers };
}

describe("remoteGate through the tunnel", () => {
  it("tells Cloudflare's edge to store nothing", async () => {
    const { status, headers } = await pass(tunnelHome(), DOMAIN);
    expect(status).toBe(403);
    expect(headers[EDGE_CACHE_HEADER.toLowerCase()]).toBe("no-store");
  });

  it("leaves a local request's caching alone", async () => {
    const { headers } = await pass(tunnelHome(), "localhost:54321");
    expect(headers[EDGE_CACHE_HEADER.toLowerCase()]).toBeUndefined();
  });
});
