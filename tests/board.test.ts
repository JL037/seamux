// The board on a machine that is new to seamux (app/lib/board.server.ts):
// it has to load before Claude Code has ever run, and with only Codex
// installed, which seamux supports as much as Claude Code.

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, it } from "vitest";

import { loadBoard, loadMessages } from "~/lib/board.server";
import { clearFailure, recordFailure } from "~/lib/send-failures.server";
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
  expect(board.sessionsKnown).toBe(true);
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
  expect(board.sessionsKnown).toBe(true);
});

it("says why when seamux was started outside cmux, in place of cmux's words", async () => {
  cmux.outsideCmux = true;
  const board = await loadBoard();
  expect(board.cmux).toMatchObject({ trouble: "outside_cmux" });
  expect(board.warnings).toEqual([]);
  expect(board.sessionsKnown).toBe(false);
});

it("says cmux isn't running when nothing listens on its socket", async () => {
  await cmux.stop();
  const board = await loadBoard();
  expect(board.cmux).toMatchObject({ trouble: "not_running" });
  expect(board.warnings).toEqual([]);
  expect(board.sessionsKnown).toBe(false);
  await cmux.start();
});

it("says cmux's socket is off when cmux runs but nothing listens", async () => {
  // A `ps` that lists cmux's app as running. Never a stand-in app: macOS
  // takes an unsigned one named cmux for the real app, damaged.
  const bin = mkdtempSync(join(tmpdir(), "seamux-ps-"));
  const app = join(process.env.SEAMUX_CMUX_APP!, "Contents/MacOS/cmux");
  writeFileSync(
    join(bin, "ps"),
    `#!/bin/sh\ncase "$*" in *comm=*) echo "${app}" ;; esac\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${path}`;
  await cmux.stop();
  try {
    const board = await loadBoard();
    expect(board.cmux).toMatchObject({ trouble: "socket_off" });
    expect(board.warnings).toEqual([]);
  } finally {
    await cmux.start();
  }
});

it("runs the `cmux` command from cmux's app bundle when it isn't on PATH", async () => {
  cmux.addSession("3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c16");
  process.env.PATH = [dirname(process.execPath), "/usr/bin", "/bin"].join(":");
  const board = await loadBoard();
  expect(board.cmux).toBeNull();
  expect(board.warnings).toEqual([]);
});

it("says cmux isn't installed when there is no `cmux` command at all", async () => {
  const bundled = join(process.env.SEAMUX_CMUX_APP!, "Contents/Resources/bin/cmux");
  const away = `${bundled}.away`;
  renameSync(bundled, away);
  process.env.PATH = [dirname(process.execPath), "/usr/bin", "/bin"].join(":");
  try {
    const board = await loadBoard();
    expect(board.cmux).toMatchObject({ trouble: "not_installed" });
  } finally {
    renameSync(away, bundled);
  }
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

it("offers a tool's own No/Yes confirmation as its options, not Approve", async () => {
  // As Claude Code 2.1.289 shows the Artifact tool's delete: unnumbered,
  // No first, and digits do nothing, so Approve's 1 would never answer it.
  const sessionId = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c17";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Artifact",
            input: { action: "delete", url: "https://claude.ai/artifact/x" },
          },
        ],
      },
    }) + "\n",
  );
  const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
  writeFileSync(
    agents,
    JSON.stringify([
      {
        pid: 1,
        cwd: "/work",
        kind: "interactive",
        startedAt: 0,
        sessionId,
        name: "demo",
        status: "waiting",
        waitingFor: "permission prompt",
      },
    ]),
  );
  const { surface } = cmux.addSession(sessionId);
  surface.screen = [
    "⏺ Artifact(delete · https://claude.ai/artifact/x)",
    "",
    "────────────────────────────────",
    ' Permanently delete "Demo Night"?',
    "",
    " ❯ No",
    "   Yes",
    "",
    " Esc to cancel · Tab to amend",
  ].join("\n");
  try {
    const board = await loadBoard();
    const card = board.cards.find((c) => c.sessionId === sessionId);
    expect(card?.waiting).toMatchObject({
      tool: "Artifact",
      approval: null,
      dialog: {
        title: 'Permanently delete "Demo Night"?',
        options: ["No", "Yes"],
        cursor: 0,
      },
    });
  } finally {
    rmSync(agents, { force: true });
  }
});

it("takes a task notification after its answered hand-back as no turn", async () => {
  // As Claude Code 2.1.289 logs a subagent's return: the <agent-message>
  // hand-back wakes the model, and the task notification for the same run
  // lands after the answer without waking it. A background shell keeps
  // `claude agents` at busy all the while.
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const user = (content: string) => ({
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content },
  });
  const reply = {
    type: "assistant",
    timestamp: "2026-01-01T00:00:00Z",
    message: {
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Both passes are done." }],
    },
  };
  const notification = (id: string) =>
    user(
      `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`,
    );
  const write = (sessionId: string, lines: object[]) =>
    writeFileSync(
      join(project, `${sessionId}.jsonl`),
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
  const handedBack = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c18";
  const notYet = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c19";
  write(handedBack, [
    user("review the PR"),
    reply,
    user(
      'Another Claude session sent a message:\n<agent-message from="a9dd2f7e8a0e90819">\nNo findings.\n</agent-message>',
    ),
    reply,
    notification("a9dd2f7e8a0e90819"),
  ]);
  write(notYet, [user("review the PR"), reply, notification("a9dd2f7e8a0e90819")]);
  const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
  const row = (sessionId: string) => ({
    pid: 1,
    cwd: "/work",
    kind: "interactive",
    startedAt: 0,
    sessionId,
    name: "demo",
    status: "busy",
  });
  writeFileSync(agents, JSON.stringify([row(handedBack), row(notYet)]));
  try {
    const board = await loadBoard();
    const card = (id: string) => board.cards.find((c) => c.sessionId === id);
    expect(card(handedBack)?.turnRunning).toBe(false);
    expect(card(notYet)?.turnRunning).toBe(true);
  } finally {
    rmSync(agents, { force: true });
  }
});

it("shows what an idle chat's prompt box holds unsent, and reads no box while a turn runs", async () => {
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const ids = {
    idle: "6b1f2e3a-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
    working: "7c2a3f4b-5d6e-4f70-9b8c-1d2e3f4a5b6c",
  };
  // One turn over, and one under way on a prompt just sent.
  writeFileSync(
    join(project, `${ids.idle}.jsonl`),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      },
    }) + "\n",
  );
  writeFileSync(
    join(project, `${ids.working}.jsonl`),
    JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "fix the login" },
    }) + "\n",
  );
  const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
  writeFileSync(
    agents,
    JSON.stringify(
      Object.entries(ids).map(([status, sessionId], pid) => ({
        pid: pid + 1,
        cwd: "/work",
        kind: "interactive",
        startedAt: 0,
        sessionId,
        name: status,
        status: status === "working" ? "busy" : "idle",
      })),
    ),
  );
  const box = [
    "⏺ Done.",
    "─".repeat(40),
    "❯ 1 - fair",
    "  2 - yes, fix it",
    "─".repeat(40),
    "  ⏵⏵ auto mode on",
  ].join("\n");
  const idle = cmux.addSession(ids.idle).surface;
  idle.screen = box;
  cmux.addSession(ids.working).surface.screen = box;
  recordFailure(ids.idle, "1 - fair 2 - yes, fix it", new Error("Nope"));
  try {
    const { cards } = await loadBoard();
    const card = (id: string) => cards.find((c) => c.sessionId === id);
    expect(card(ids.idle)?.unsentDraft).toBe("1 - fair\n2 - yes, fix it");
    expect(card(ids.idle)?.sendFailure).toMatchObject({
      text: "1 - fair 2 - yes, fix it",
      error: "Nope",
    });
    expect(card(ids.working)?.sendFailure).toBeNull();
    expect(card(ids.working)?.unsentDraft).toBeNull();
    expect(
      cmux.calls("terminal.replay").map((r) => r.params.surface_id),
    ).toEqual([idle.id]);
  } finally {
    clearFailure(ids.idle);
    rmSync(agents, { force: true });
  }
});
