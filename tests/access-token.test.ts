// The Cloudflare Access token is the tunnel's only login: a request through
// it asks for no HTTP Basic credentials. So everything short of a token the
// team signed, for this application, in date, is refused.

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyAccessToken } from "~/lib/remote.server";

const AUD = "app-aud";
const NOW = () => Math.floor(Date.now() / 1000);

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid } };
}

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function token(
  key: { kid: string; privateKey: KeyObject },
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: key.kid },
): string {
  const signed = `${b64(header)}.${b64(claims)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signed), key.privateKey);
  return `${signed}.${signature.toString("base64url")}`;
}

// Serves each team's certs endpoint, counting the fetches.
function serveCerts(certs: Record<string, object[] | "down">) {
  const fetched: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const team = new URL(url).host;
      fetched.push(team);
      const keys = certs[team];
      if (!keys || keys === "down") return new Response("", { status: 503 });
      return Response.json({ keys });
    }),
  );
  return fetched;
}

// Each test gets a team of its own, since the module keeps each team's keys.
let teams = 0;
function team() {
  return `team${++teams}.cloudflareaccess.com`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const valid = () => ({ aud: AUD, exp: NOW() + 600, nbf: NOW() - 10 });

describe("verifyAccessToken", () => {
  it("accepts a token the team signed, for this application, in date", async () => {
    const t = team();
    const key = keyPair("k1");
    serveCerts({ [t]: [key.jwk] });
    const checked = await verifyAccessToken(token(key, valid()), {
      team: t,
      aud: AUD,
    });
    expect(checked).toHaveProperty("claims.aud", AUD);
  });

  it("accepts this application among several audiences", async () => {
    const t = team();
    const key = keyPair("k1");
    serveCerts({ [t]: [key.jwk] });
    const checked = await verifyAccessToken(
      token(key, { ...valid(), aud: ["other", AUD] }),
      { team: t, aud: AUD },
    );
    expect(checked).toHaveProperty("claims");
  });

  it("refuses a token signed by a key the team doesn't publish", async () => {
    const t = team();
    const published = keyPair("k1");
    const forged = keyPair("k1");
    serveCerts({ [t]: [published.jwk] });
    expect(
      await verifyAccessToken(token(forged, valid()), { team: t, aud: AUD }),
    ).toEqual({ reason: "its Access token's signature is invalid" });
  });

  it("refuses a key id the team doesn't publish", async () => {
    const t = team();
    serveCerts({ [t]: [keyPair("k1").jwk] });
    const checked = await verifyAccessToken(token(keyPair("k2"), valid()), {
      team: t,
      aud: AUD,
    });
    expect(checked).toHaveProperty("reason");
    expect(checked).not.toHaveProperty("claims");
  });

  it("refuses claims changed after signing", async () => {
    const t = team();
    const key = keyPair("k1");
    serveCerts({ [t]: [key.jwk] });
    const [head, , signature] = token(key, { ...valid(), aud: "other" }).split(
      ".",
    );
    expect(
      await verifyAccessToken(`${head}.${b64(valid())}.${signature}`, {
        team: t,
        aud: AUD,
      }),
    ).toEqual({ reason: "its Access token's signature is invalid" });
  });

  it("refuses another application's token", async () => {
    const t = team();
    const key = keyPair("k1");
    serveCerts({ [t]: [key.jwk] });
    expect(
      await verifyAccessToken(token(key, { ...valid(), aud: "other" }), {
        team: t,
        aud: AUD,
      }),
    ).toEqual({
      reason:
        "its Access login is for a different application from the one in SEAMUX_CF_AUD",
    });
  });

  it("refuses an expired login, past a minute's leeway", async () => {
    const t = team();
    const key = keyPair("k1");
    serveCerts({ [t]: [key.jwk] });
    const check = (exp: number) =>
      verifyAccessToken(token(key, { aud: AUD, exp }), { team: t, aud: AUD });
    expect(await check(NOW() - 30)).toHaveProperty("claims");
    expect(await check(NOW() - 120)).toEqual({
      reason: "its Access login has expired",
    });
  });

  it("refuses a token with no expiry", async () => {
    const t = team();
    const key = keyPair("k1");
    serveCerts({ [t]: [key.jwk] });
    expect(
      await verifyAccessToken(token(key, { aud: AUD }), { team: t, aud: AUD }),
    ).toEqual({ reason: "its Access login has expired" });
  });

  it("refuses a login not valid yet, past a minute's leeway", async () => {
    const t = team();
    const key = keyPair("k1");
    serveCerts({ [t]: [key.jwk] });
    expect(
      await verifyAccessToken(token(key, { ...valid(), nbf: NOW() + 120 }), {
        team: t,
        aud: AUD,
      }),
    ).toEqual({ reason: "its Access login isn't valid yet" });
  });

  it("refuses any algorithm but RS256, without fetching keys", async () => {
    const t = team();
    const key = keyPair("k1");
    const fetched = serveCerts({ [t]: [key.jwk] });
    for (const alg of ["none", "HS256", "RS512"]) {
      expect(
        await verifyAccessToken(token(key, valid(), { alg, kid: "k1" }), {
          team: t,
          aud: AUD,
        }),
      ).toEqual({ reason: "its Access token is malformed" });
    }
    expect(fetched).toEqual([]);
  });

  it("refuses what isn't a JWT", async () => {
    const t = team();
    serveCerts({ [t]: [] });
    for (const bad of ["", "a.b", "a.b.c.d", "!!.!!.!!"]) {
      expect(await verifyAccessToken(bad, { team: t, aud: AUD })).toEqual({
        reason: "its Access token is malformed",
      });
    }
  });

  it("refuses everything while the team's keys can't be fetched", async () => {
    const t = team();
    serveCerts({ [t]: "down" });
    expect(
      await verifyAccessToken(token(keyPair("k1"), valid()), {
        team: t,
        aud: AUD,
      }),
    ).toEqual({
      reason: `its Access token isn't signed by any key of ${t}, the team in SEAMUX_CF_TEAM`,
    });
  });

  it("fetches the team's keys once for many requests", async () => {
    const t = team();
    const key = keyPair("k1");
    const fetched = serveCerts({ [t]: [key.jwk] });
    await Promise.all(
      [1, 2, 3].map(() =>
        verifyAccessToken(token(key, valid()), { team: t, aud: AUD }),
      ),
    );
    await verifyAccessToken(token(key, valid()), { team: t, aud: AUD });
    expect(fetched).toEqual([t]);
  });

  it("fetches again for a rotated key, but not more than every 30s", async () => {
    const t = team();
    const old = keyPair("k1");
    const rotated = keyPair("k2");
    const certs: Record<string, object[]> = { [t]: [old.jwk] };
    const fetched = serveCerts(certs);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await verifyAccessToken(token(old, valid()), { team: t, aud: AUD });
      certs[t] = [old.jwk, rotated.jwk];
      // Too soon: the new key id isn't fetched yet.
      expect(
        await verifyAccessToken(token(rotated, valid()), { team: t, aud: AUD }),
      ).not.toHaveProperty("claims");
      vi.setSystemTime(Date.now() + 31_000);
      expect(
        await verifyAccessToken(token(rotated, valid()), { team: t, aud: AUD }),
      ).toHaveProperty("claims");
      expect(fetched).toEqual([t, t]);
    } finally {
      vi.useRealTimers();
    }
  });
});
