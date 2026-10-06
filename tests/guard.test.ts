// What stands in front of the board's actions and reads once remoteGate has
// let a request in. A browser lets any website POST a form to 127.0.0.1, and
// React Router's own Origin check doesn't cover a resource route
// (knowledge/vite-and-react-router.md), so assertFromBoard alone keeps other
// sites from spawning and driving sessions.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requireAuth } from "~/lib/auth.server";
import { basicAuthHeader } from "~/lib/credentials";
import {
  assertFromBoard,
  assertLocalHost,
  assertLocalRead,
} from "~/lib/guard.server";
import { SEAMUX_HOME } from "~/lib/paths.server";
import { lanHost } from "~/lib/remote.server";

const DOMAIN = "board.example.com";
const LAN = lanHost();

// Writes SEAMUX_HOME's .env and switches, as the Remote tab would leave them.
function configure(
  switches: Record<string, boolean>,
  env: Record<string, string> = {},
) {
  mkdirSync(SEAMUX_HOME, { recursive: true });
  writeFileSync(
    join(SEAMUX_HOME, ".env"),
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  writeFileSync(join(SEAMUX_HOME, ".seamux.json"), JSON.stringify(switches));
}

const TUNNEL_ENV = {
  SEAMUX_CF_TOKEN: "token",
  SEAMUX_CF_DOMAIN: DOMAIN,
  SEAMUX_CF_TEAM: "team",
  SEAMUX_CF_AUD: "aud",
};
const CREDENTIALS = { SEAMUX_USER: "me", SEAMUX_PASS: "secret" };

function post(host: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/session/x", {
    method: "POST",
    headers: { host, ...headers },
  });
}

// The status a guard refused with, or null when it let the request through.
function refusal(check: () => void): number | null {
  try {
    check();
    return null;
  } catch (err) {
    return (err as { init?: { status?: number } }).init?.status ?? -1;
  }
}

beforeEach(() => configure({}));
afterEach(() => {
  rmSync(join(SEAMUX_HOME, ".env"), { force: true });
  rmSync(join(SEAMUX_HOME, ".seamux.json"), { force: true });
});

describe("assertFromBoard", () => {
  it("lets the board's own page post to itself on this Mac", () => {
    for (const host of ["localhost:54321", "127.0.0.1:54321", "[::1]:54321"]) {
      expect(
        refusal(() =>
          assertFromBoard(post(host, { origin: `http://${host}` })),
        ),
      ).toBeNull();
    }
  });

  it("refuses a post another website made", () => {
    expect(
      refusal(() =>
        assertFromBoard(
          post("localhost:54321", { origin: "https://evil.example" }),
        ),
      ),
    ).toBe(403);
  });

  it("refuses a post with no Origin", () => {
    expect(refusal(() => assertFromBoard(post("localhost:54321")))).toBe(403);
  });

  it("refuses the board's Origin on another port", () => {
    expect(
      refusal(() =>
        assertFromBoard(
          post("localhost:54321", { origin: "http://localhost:3000" }),
        ),
      ),
    ).toBe(403);
  });

  it("refuses a name rebound to this Mac, even posting to itself", () => {
    const host = "rebound.example:54321";
    expect(
      refusal(() => assertFromBoard(post(host, { origin: `http://${host}` }))),
    ).toBe(403);
  });

  it("accepts the tunnel's hostname over https only, while it's on", () => {
    configure({ remote: true, tunnel: true }, TUNNEL_ENV);
    expect(
      refusal(() =>
        assertFromBoard(post(DOMAIN, { origin: `https://${DOMAIN}` })),
      ),
    ).toBeNull();
    expect(
      refusal(() =>
        assertFromBoard(post(DOMAIN, { origin: `http://${DOMAIN}` })),
      ),
    ).toBe(403);
    configure({ remote: true, tunnel: false }, TUNNEL_ENV);
    expect(
      refusal(() =>
        assertFromBoard(post(DOMAIN, { origin: `https://${DOMAIN}` })),
      ),
    ).toBe(403);
  });

  it("accepts the .local name over http only while mDNS is on", () => {
    const host = `${LAN}:54321`;
    const fromLan = () =>
      refusal(() => assertFromBoard(post(host, { origin: `http://${host}` })));
    configure({ remote: true, mdns: true }, CREDENTIALS);
    expect(fromLan()).toBeNull();
    configure({ remote: true, mdns: false }, CREDENTIALS);
    expect(fromLan()).toBe(403);
    configure({ remote: false, mdns: true }, CREDENTIALS);
    expect(fromLan()).toBe(403);
  });
});

describe("assertLocalRead", () => {
  it("serves a file to the board, and to a request with no fetch metadata", () => {
    for (const site of ["same-origin", "none", null]) {
      const headers: Record<string, string> = site
        ? { "sec-fetch-site": site }
        : {};
      expect(
        refusal(() => assertLocalRead(post("localhost:54321", headers))),
      ).toBeNull();
    }
  });

  it("refuses a read another site's page made", () => {
    for (const site of ["cross-site", "same-site"]) {
      expect(
        refusal(() =>
          assertLocalRead(
            post("localhost:54321", { "sec-fetch-site": site }),
          ),
        ),
      ).toBe(403);
    }
  });

  it("refuses a name rebound to this Mac", () => {
    expect(refusal(() => assertLocalHost(post("rebound.example")))).toBe(403);
  });
});

describe("requireAuth", () => {
  const passed = new Response("board");
  async function answer(request: Request): Promise<Response> {
    return (await requireAuth(
      { request } as Parameters<typeof requireAuth>[0],
      async () => passed,
    )) as Response;
  }

  it("lets this Mac in without asking while no credentials are set", async () => {
    expect(await answer(post("localhost:54321"))).toBe(passed);
  });

  it("never answers the .local name without credentials set", async () => {
    configure({ remote: true, mdns: true });
    expect((await answer(post(`${LAN}:54321`))).status).toBe(403);
  });

  it("asks for the password once credentials are set, even at localhost", async () => {
    configure({}, CREDENTIALS);
    const asked = await answer(post("localhost:54321"));
    expect(asked.status).toBe(401);
    expect(asked.headers.get("www-authenticate")).toMatch(/^Basic /);
    const wrong = basicAuthHeader({ user: "me", pass: "guess" });
    expect(
      (await answer(post("localhost:54321", { authorization: wrong }))).status,
    ).toBe(401);
    const right = basicAuthHeader({ user: "me", pass: "secret" });
    expect(await answer(post("localhost:54321", { authorization: right }))).toBe(
      passed,
    );
  });

  it("refuses the tunnel without an Access token, the password notwithstanding", async () => {
    configure({ remote: true, tunnel: true }, { ...TUNNEL_ENV, ...CREDENTIALS });
    const right = basicAuthHeader({ user: "me", pass: "secret" });
    const refused = await answer(post(DOMAIN, { authorization: right }));
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("no Cloudflare Access token");
  });
});
