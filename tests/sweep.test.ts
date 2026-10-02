import { expect, it } from "vitest";

import { tallyMissing } from "~/lib/sweep";

it("sweeps a chat once it has been missing for enough healthy polls in a row", () => {
  const missing = new Map<string, number>();
  const poll = () => tallyMissing(missing, ["a", "b"], new Set(["a"]), true, 3);
  expect(poll()).toEqual([]);
  expect(poll()).toEqual([]);
  expect(poll()).toEqual(["b"]);
  expect(missing.has("b")).toBe(false);
});

it("starts the count again after a poll that can't see every chat", () => {
  const missing = new Map<string, number>();
  const poll = (healthy: boolean) =>
    tallyMissing(missing, ["b"], new Set(), healthy, 3);
  poll(true);
  poll(true);
  expect(poll(false)).toEqual([]);
  expect(poll(true)).toEqual([]);
  expect(poll(true)).toEqual([]);
  expect(poll(true)).toEqual(["b"]);
});

it("starts the count again when the chat is back on the board", () => {
  const missing = new Map<string, number>();
  const poll = (present: string[]) =>
    tallyMissing(missing, ["b"], new Set(present), true, 3);
  poll([]);
  poll([]);
  expect(poll(["b"])).toEqual([]);
  expect(poll([])).toEqual([]);
  expect(poll([])).toEqual([]);
  expect(poll([])).toEqual(["b"]);
});

it("never sweeps a chat on the board, however long", () => {
  const missing = new Map<string, number>();
  for (let i = 0; i < 10; i++) {
    expect(tallyMissing(missing, ["a"], new Set(["a"]), true, 3)).toEqual([]);
  }
});
