// The board on a machine that is new to seamux (app/lib/board.server.ts):
// it has to load before Claude Code has ever run, and with only Codex
// installed, which seamux supports as much as Claude Code.

import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, it } from "vitest";

import { loadBoard } from "~/lib/board.server";
import { FakeCmux } from "./fake-cmux";

let cmux: FakeCmux;
const path = process.env.PATH;

beforeEach(async () => {
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
});

afterEach(async () => {
  process.env.PATH = path;
  await cmux.stop();
});

it("loads before Claude Code has ever run", async () => {
  // The test home has no ~/.claude/projects.
  const board = await loadBoard();
  expect(board.cards).toEqual([]);
  expect(board.warnings).toEqual([]);
});

it("loads with only Codex installed, and no claude to run", async () => {
  // A PATH with the fake cmux but no claude at all.
  const bin = mkdtempSync(join(tmpdir(), "seamux-bin-"));
  copyFileSync(
    fileURLToPath(new URL("./bin/cmux", import.meta.url)),
    join(bin, "cmux"),
  );
  process.env.PATH = [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":");
  const board = await loadBoard();
  expect(board.cards).toEqual([]);
  expect(board.warnings).toEqual([]);
});
