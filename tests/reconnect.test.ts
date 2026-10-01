// When a chat stopped on a failed request is resumed
// (app/lib/reconnect.server.ts), the API's answer aside: once, after its
// backoff, and never for an error from before the board started.

import { expect, it } from "vitest";

import type { ApiError, Card } from "~/lib/board";
import { due, settled } from "~/lib/reconnect.server";

const STARTED = 1_000_000;
const AT = STARTED + 60_000;

function card(fields: Partial<Card> = {}): Card {
  return {
    sessionId: "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c15",
    engine: "claude",
    column: "idle",
    drivable: true,
    closing: null,
    waiting: null,
    apiError: unreachable(AT),
    ...fields,
  } as unknown as Card;
}

function unreachable(at: number): ApiError {
  return {
    kind: "server_error",
    text: "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
    at,
  };
}

it("resumes a chat stopped on a failed request, after 30 seconds", () => {
  expect(due(card(), AT + 29_000, STARTED, undefined)).toBe(false);
  expect(due(card(), AT + 30_000, STARTED, undefined)).toBe(true);
});

it("resumes each error once, waiting longer each time, and three times at most", () => {
  const later = AT + 10 * 60_000;
  expect(due(card(), later, STARTED, { errorAt: AT, count: 1 })).toBe(false);
  const again = card({ apiError: unreachable(AT + 90_000) });
  expect(due(again, AT + 90_000 + 59_000, STARTED, { errorAt: AT, count: 1 })).toBe(false);
  expect(due(again, AT + 90_000 + 60_000, STARTED, { errorAt: AT, count: 1 })).toBe(true);
  expect(due(again, later, STARTED, { errorAt: AT, count: 3 })).toBe(false);
});

it("leaves an error from before the board started", () => {
  const old = card({ apiError: unreachable(STARTED - 1) });
  expect(due(old, AT, STARTED, undefined)).toBe(false);
});

it("leaves an expired login to the sign-in", () => {
  const login = card({
    apiError: { kind: "authentication_failed", text: "Login expired · Please run /login", at: AT },
  });
  expect(due(login, AT + 60_000, STARTED, undefined)).toBe(false);
});

it("leaves a chat that is working, closing, closed, or out of reach", () => {
  const now = AT + 60_000;
  expect(due(card({ column: "working" }), now, STARTED, undefined)).toBe(false);
  expect(due(card({ column: "done" }), now, STARTED, undefined)).toBe(false);
  expect(due(card({ drivable: false }), now, STARTED, undefined)).toBe(false);
  expect(due(card({ closing: { state: "cleaning", note: null } }), now, STARTED, undefined)).toBe(false);
  expect(due(card({ engine: "codex" }), now, STARTED, undefined)).toBe(false);
});

it("starts the count afresh once the chat settles on a reply, not while a resume runs", () => {
  expect(settled(card({ apiError: null }))).toBe(true);
  expect(settled(undefined)).toBe(true);
  expect(settled(card({ column: "working", apiError: null }))).toBe(false);
  expect(settled(card())).toBe(false);
});
