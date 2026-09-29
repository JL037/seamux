// The board on a machine that is new to seamux (app/lib/board.server.ts):
// it has to load before Claude Code has ever run, and with only Codex
// installed, which seamux supports as much as Claude Code.

import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, it } from "vitest";

import { loadBoard, loadMessages } from "~/lib/board.server";
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

it("shows `!` commands, and what a backgrounded one wrote", async () => {
  // As Claude Code logs them: a command that ran past its timeout records
  // only where its output went, and one still running has no output yet.
  const sessionId = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c15";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  const tasks = join(mkdtempSync(join(tmpdir(), "seamux-tasks-")), "tasks");
  mkdirSync(project, { recursive: true });
  mkdirSync(tasks);
  const output = join(tasks, "baou49weh.output");
  writeFileSync(output, "Open this URL in your browser:\n  https://example.test/verify\n");
  const user = (content: string, at: string) =>
    JSON.stringify({ type: "user", timestamp: at, message: { role: "user", content } });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      user("<bash-input> echo hi</bash-input>", "2026-01-01T00:00:00Z"),
      user("<bash-stdout>hi</bash-stdout><bash-stderr></bash-stderr>", "2026-01-01T00:00:01Z"),
      user("<bash-input>tool auth login</bash-input>", "2026-01-01T00:00:02Z"),
      user(
        `<bash-stdout>Command did not complete within its 120s timeout and was moved to the background (ID: baou49weh). Output is being written to: ${output}. You will be notified when it completes.</bash-stdout><bash-stderr></bash-stderr>`,
        "2026-01-01T00:02:02Z",
      ),
      user("<bash-input>sleep 600</bash-input>", "2026-01-01T00:03:00Z"),
    ].join("\n") + "\n",
  );

  const messages = await loadMessages(sessionId);
  expect(messages).toEqual([
    { role: "shell", command: "echo hi", output: "hi", at: "2026-01-01T00:00:00Z" },
    {
      role: "shell",
      command: "tool auth login",
      output: expect.stringContaining("https://example.test/verify"),
      at: "2026-01-01T00:00:02Z",
    },
    { role: "shell", command: "sleep 600", output: null, at: "2026-01-01T00:03:00Z" },
  ]);
});
