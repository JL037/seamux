// Fan-out sets on the board and in `seamux wait` (app/lib/protocol.server.ts):
// a worker whose session ended without reporting is gone, a set settles once
// no worker is still expected to report, and a settled set leaves the board
// with the DONE cards.

import { rmSync } from "node:fs";

import { afterEach, beforeEach, expect, it } from "vitest";

import { DONE_VISIBLE_MS } from "~/lib/board";
import { loadBoard } from "~/lib/board.server";
import { sessionsAlive } from "~/lib/drive.server";
import {
  DISPATCH_DIR,
  dispatchStatus,
  SPAWN_GRACE_MS,
  writeManifest,
  writeMarker,
  type Manifest,
} from "~/lib/protocol.server";
import { FakeCmux } from "./fake-cmux";

let cmux: FakeCmux;

beforeEach(async () => {
  rmSync(DISPATCH_DIR, { recursive: true, force: true });
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
});

afterEach(async () => {
  await cmux.stop();
});

const MINUTE = 60 * 1000;

// A dispatch whose workers were spawned `ago` ms before now, each with a
// session id of its own key.
function declare(id: string, keys: string[], createdAt: number, ago = 0) {
  const manifest: Manifest = {
    id,
    title: `Set ${id}`,
    parentSessionId: null,
    createdAt,
    workers: keys.map((key) => ({
      key,
      cwd: "/work",
      prompt: "Do it",
      sessionId: `session-${key}`,
      spawnedAt: createdAt + ago,
    })),
  };
  writeManifest(manifest);
  return manifest;
}

function report(id: string, worker: string, at: number) {
  writeMarker({
    dispatchId: id,
    worker,
    status: "ok",
    summary: "Done",
    result: null,
    sessionId: `session-${worker}`,
    at,
  });
}

it("settles a set once a pending worker's session is gone", async () => {
  const now = Date.now();
  declare("d-00000001", ["kept", "closed", "running"], now - 20 * MINUTE);
  report("d-00000001", "kept", now - 5 * MINUTE);
  // "running" still has its session; "closed" has none anywhere.
  cmux.addSession("session-running");

  let set = (await loadBoard(now)).dispatches[0];
  expect(set.workers.map((w) => w.status)).toEqual(["ok", "gone", null]);
  expect(set.settledAt).toBeNull();

  cmux.endSession("session-running");
  set = (await loadBoard(now)).dispatches[0];
  expect(set.workers.map((w) => w.status)).toEqual(["ok", "gone", "gone"]);
  expect(set.settledAt).not.toBeNull();

  // `seamux wait` asks the same sources, and is done waiting.
  const status = dispatchStatus("d-00000001", await sessionsAlive(), now);
  expect(status).toMatchObject({
    complete: true,
    pending: [],
    gone: ["closed", "running"],
  });
});

it("never declares a just-spawned worker gone", async () => {
  const now = Date.now();
  // Spawned a moment ago, before its session shows anywhere.
  declare("d-00000002", ["fresh"], now - MINUTE, MINUTE - 10_000);
  let set = (await loadBoard(now)).dispatches[0];
  expect(set.workers[0].status).toBeNull();
  expect(set.settledAt).toBeNull();
  expect(
    dispatchStatus("d-00000002", await sessionsAlive(), now),
  ).toMatchObject({ complete: false, pending: ["fresh"], gone: [] });

  // Past the grace period, still nowhere: gone.
  const later = now + SPAWN_GRACE_MS;
  set = (await loadBoard(later)).dispatches[0];
  expect(set.workers[0].status).toBe("gone");
});

it("declares no worker gone when the sessions can't be listed", async () => {
  const now = Date.now();
  declare("d-00000003", ["unseen"], now - 20 * MINUTE);
  await cmux.stop();
  const set = (await loadBoard(now)).dispatches[0];
  expect(set.workers[0].status).toBeNull();
  expect(await sessionsAlive()).toBeNull();
  await cmux.start();
});

it("drops a settled set after the DONE window, counted from when it settled", async () => {
  const now = Date.now();
  // Started two days ago, but its last worker reported ten minutes ago.
  declare("d-00000004", ["a", "b"], now - 48 * 60 * MINUTE);
  report("d-00000004", "a", now - 47 * 60 * MINUTE);
  report("d-00000004", "b", now - 10 * MINUTE);
  // Settled just past the window.
  declare("d-00000005", ["c"], now - 2 * 60 * MINUTE);
  report("d-00000005", "c", now - DONE_VISIBLE_MS - MINUTE);

  const sets = (await loadBoard(now)).dispatches;
  expect(sets.map((s) => s.id)).toEqual(["d-00000004"]);
  expect(sets[0].settledAt).toBe(now - 10 * MINUTE);

  const later = now + DONE_VISIBLE_MS;
  expect((await loadBoard(later)).dispatches).toEqual([]);
});
