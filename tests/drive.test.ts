// What seamux's write verbs (app/lib/drive.server.ts) send to cmux: which
// methods, with which params, in which order. Each is the contract a working
// board depends on, and each was measured against cmux and Claude Code by
// hand first (docs/findings.md); these keep it from drifting.

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerApproval,
  answerDialog,
  answerQuestion,
  closeChat,
  dispatch,
  interrupt,
  listLive,
  readDialog,
  renameLive,
  sendMessage,
  UnsentError,
} from "~/lib/drive.server";
import { FakeCmux, type FakeSurface } from "./fake-cmux";

let cmux: FakeCmux;

beforeEach(async () => {
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
});

afterEach(async () => {
  // Every call that acts on a terminal names it, both surface and workspace:
  // cmux falls back to the caller's own terminal otherwise, which is
  // whatever seamux runs in (CLAUDE.md).
  for (const r of cmux.requests) {
    if (
      /^(surface\.(send_text|send_key|read_text|close)|terminal\.paste)$/.test(
        r.method,
      )
    ) {
      expect(r.params, r.method).toMatchObject({
        surface_id: expect.any(String),
        workspace_id: expect.any(String),
      });
    }
  }
  await cmux.stop();
});

const input = (surface: FakeSurface) =>
  surface.input.map((i) => `${i.kind}:${i.value}`);

describe("listLive", () => {
  it("lists the sessions cmux says are live, with their surfaces", async () => {
    const claude = cmux.addSession("claude-live", {
      cwd: "/work/a",
    });
    const codex = cmux.addSession("codex-live", {
      agent: "codex",
      // cmux never marks a Codex session active for its surface.
      active_for_surface: false,
      transcript_path: "/codex/rollout.jsonl",
    });
    cmux.addSession("claude-inactive", { active_for_surface: false });
    cmux.addSession("claude-dead", { stored_pid_exists: false });
    cmux.addSession("amp-live", { agent: "amp" });

    const live = await listLive();

    expect([...live.keys()].sort()).toEqual(["claude-live", "codex-live"]);
    expect(live.get("claude-live")).toEqual({
      engine: "claude",
      surface: {
        surfaceId: claude.surface.id,
        workspaceId: claude.workspace.id,
      },
      cwd: "/work/a",
      transcript: null,
    });
    expect(live.get("codex-live")).toMatchObject({
      engine: "codex",
      transcript: "/codex/rollout.jsonl",
    });
    expect(live.get("codex-live")!.surface.surfaceId).toBe(codex.surface.id);
  });
});

describe("sendMessage", () => {
  it("types a one-line message into Claude Code, then presses Enter", async () => {
    const { surface } = cmux.addSession("s");
    await sendMessage("s", "fix the login");
    expect(input(surface)).toEqual(["text:fix the login", "key:enter"]);
  });

  it("types a message with line breaks, with Shift+Enter between its lines", async () => {
    const { surface } = cmux.addSession("s");
    await sendMessage("s", "one\ntwo\r\nthree");
    expect(input(surface)).toEqual([
      "text:one",
      "key:shift+enter",
      "text:two",
      "key:shift+enter",
      "text:three",
      "key:enter",
    ]);
  });

  it("types a long message a little at a time, which Claude Code would otherwise take for a paste", async () => {
    const { surface } = cmux.addSession("s");
    const text = "x".repeat(250);
    await sendMessage("s", text);
    expect(input(surface)).toEqual([
      `text:${"x".repeat(100)}`,
      `text:${"x".repeat(100)}`,
      `text:${"x".repeat(50)}`,
      "key:enter",
    ]);
  });

  it("pastes a message with a tab, which typing would autocomplete", async () => {
    const { surface } = cmux.addSession("s");
    await sendMessage("s", "a\tb");
    expect(input(surface)).toEqual(["paste:a\tb", "key:enter"]);
  });

  // The prompt box as Claude Code draws it, holding `text`.
  const promptBox = (text: string) =>
    [
      "⏺ ok",
      "─".repeat(40),
      `❯ ${text}`,
      "─".repeat(40),
      "  ⏸ manual mode on",
    ].join("\n");

  it("presses Enter again while the message still sits in the prompt box", async () => {
    const { surface } = cmux.addSession("s");
    let enters = 0;
    cmux.onInput((s, i) => {
      if (i.kind === "text") s.screen = promptBox(i.value);
      // The first Enter is lost, as it is while Claude Code takes a paste in.
      if (i.value === "enter" && ++enters > 1) s.screen = promptBox("");
    });
    await sendMessage("s", "fix the login");
    expect(input(surface)).toEqual([
      "text:fix the login",
      "key:enter",
      "key:enter",
    ]);
  });

  it("presses Enter again when Claude Code holds a message it stripped invisible characters from", async () => {
    const { surface } = cmux.addSession("s");
    let enters = 0;
    cmux.onInput((s, i) => {
      if (i.value !== "enter") return;
      s.screen = promptBox(++enters > 1 ? "" : "fix the login");
    });
    await sendMessage("s", "fix the\u200b login\u00ad");
    expect(input(surface)).toEqual([
      "text:fix the\u200b login\u00ad",
      "key:enter",
      "key:enter",
    ]);
  });

  it("types a carriage return once Enter has been pressed four times to no effect", async () => {
    const { surface } = cmux.addSession("s");
    cmux.onInput((s, i) => {
      if (i.kind === "text")
        s.screen = promptBox(i.value === "\r\n" ? "" : i.value);
    });
    await sendMessage("s", "fix the login");
    expect(input(surface).slice(-2)).toEqual(["key:enter", "text:\r\n"]);
  });

  it("says so when the message never leaves the prompt box", async () => {
    const { surface } = cmux.addSession("s");
    cmux.onInput((s, i) => {
      if (i.kind === "text" && i.value !== "\r\n")
        s.screen = promptBox(i.value);
    });
    await expect(sendMessage("s", "fix the login")).rejects.toBeInstanceOf(
      UnsentError,
    );
    expect(input(surface).slice(-5)).toEqual([
      "key:enter",
      "key:enter",
      "key:enter",
      "key:enter",
      "text:\r\n",
    ]);
  });

  it("always pastes into Codex, which folds long typed input", async () => {
    const { surface } = cmux.addSession("s", {
      agent: "codex",
      active_for_surface: false,
    });
    await sendMessage("s", "short");
    expect(input(surface)).toEqual(["paste:short", "key:enter"]);
  });

  it("refuses a session that isn't running in cmux", async () => {
    await expect(sendMessage("gone", "hello")).rejects.toThrow(
      "This session is not running in a cmux surface",
    );
    expect(cmux.requests).toEqual([]);
  });
});

describe("interrupt", () => {
  it("presses Esc", async () => {
    const { surface } = cmux.addSession("s");
    await interrupt("s");
    expect(input(surface)).toEqual(["key:escape"]);
  });
});

describe("answerApproval", () => {
  it("approves Claude Code with 1, which is always Yes", async () => {
    const { surface } = cmux.addSession("s");
    await answerApproval("s", true, "claude");
    expect(input(surface)).toEqual(["text:1"]);
  });

  it("approves Codex with y", async () => {
    const { surface } = cmux.addSession("s", {
      agent: "codex",
      active_for_surface: false,
    });
    await answerApproval("s", true, "codex");
    expect(input(surface)).toEqual(["text:y"]);
  });

  it("denies with Esc, since No has no fixed number", async () => {
    const { surface } = cmux.addSession("s");
    await answerApproval("s", false, "claude");
    expect(input(surface)).toEqual(["key:escape"]);
  });
});

describe("answerQuestion", () => {
  const question = (multiSelect: boolean) => ({
    question: "Which one?",
    header: "Pick",
    multiSelect,
    options: [
      { label: "A", description: null, preview: null },
      { label: "B", description: null, preview: null },
    ],
  });

  it("picks a single-select option with its digit", async () => {
    const { surface } = cmux.addSession("s");
    await answerQuestion("s", [question(false)], [{ picks: [1] }]);
    expect(input(surface)).toEqual(["text:2"]);
  });

  it("toggles multi-select options, tabs on, and submits the review", async () => {
    const { surface } = cmux.addSession("s");
    await answerQuestion("s", [question(true)], [{ picks: [0, 1] }]);
    expect(input(surface)).toEqual(["text:1", "text:2", "key:tab", "text:1"]);
  });

  it("types an answer of its own into the row after the options", async () => {
    const { surface } = cmux.addSession("s");
    await answerQuestion("s", [question(false)], [{ text: "neither" }]);
    expect(input(surface)).toEqual(["text:3", "text:neither", "key:enter"]);
  });
});

describe("dialogs", () => {
  const screen = [
    "● Some earlier reply",
    "",
    "────────────────────────────────",
    " Background work is running",
    " A shell is still running.",
    "",
    " ❯ 1. Exit and stop tasks",
    "   2. Move to background and exit",
    "   3. Stay",
    "",
    " Esc to cancel",
  ].join("\n");

  it("reads a numbered dialog off the screen", async () => {
    const { surface, workspace } = cmux.addSession("s");
    surface.screen = screen;
    const dialog = await readDialog({
      surfaceId: surface.id,
      workspaceId: workspace.id,
    });
    expect(dialog).toMatchObject({
      title: "Background work is running",
      detail: ["A shell is still running."],
      options: ["Exit and stop tasks", "Move to background and exit", "Stay"],
    });
    expect(cmux.calls("surface.read_text")).toHaveLength(1);
  });

  it("answers the dialog still open with the option's digit", async () => {
    const { surface, workspace } = cmux.addSession("s");
    surface.screen = screen;
    const { key } = (await readDialog({
      surfaceId: surface.id,
      workspaceId: workspace.id,
    }))!;
    await answerDialog("s", key, 2);
    expect(input(surface)).toEqual(["text:3"]);
  });

  it("types nothing once the dialog has gone", async () => {
    const { surface } = cmux.addSession("s");
    surface.screen = "❯ ";
    await expect(answerDialog("s", "stale", 0)).rejects.toThrow(
      "That dialog is no longer open",
    );
    expect(input(surface)).toEqual([]);
  });
});

describe("closeChat", () => {
  // The terminal's side: /exit and Enter end the session, as Claude Code does.
  const exitsOnEnter = (sessionId: string) =>
    cmux.onInput((surface, i) => {
      if (i.kind === "key" && surface.input.at(-2)?.value === "/exit") {
        cmux.endSession(sessionId);
      }
    });

  it("sends /exit, then closes the workspace it was the only tab of", async () => {
    const { surface, workspace } = cmux.addSession("s");
    exitsOnEnter("s");
    await closeChat("s");
    expect(input(surface)).toEqual(["paste:/exit", "key:enter"]);
    expect(cmux.calls("workspace.close")).toEqual([
      expect.objectContaining({ params: { workspace_id: workspace.id } }),
    ]);
    expect(cmux.workspaces).toEqual([]);
  });

  it("closes only its tab when the workspace has others", async () => {
    const { surface, workspace } = cmux.addSession("s");
    const other = cmux.addSurface(workspace);
    exitsOnEnter("s");
    await closeChat("s");
    expect(cmux.calls("surface.close")).toEqual([
      expect.objectContaining({
        params: { surface_id: surface.id, workspace_id: workspace.id },
      }),
    ]);
    expect(workspace.surfaces).toEqual([other]);
  });

  it("leaves nothing to close once the workspace closed itself", async () => {
    const { workspace } = cmux.addSession("s");
    cmux.onInput((_, i) => {
      if (i.kind === "key") {
        cmux.endSession("s");
        cmux.workspaces.splice(cmux.workspaces.indexOf(workspace), 1);
      }
    });
    await closeChat("s");
    expect(cmux.calls("workspace.close")).toEqual([]);
    expect(cmux.calls("surface.close")).toEqual([]);
  });
});

describe("renameLive", () => {
  it("sends /rename, and retitles a workspace it is the only tab of", async () => {
    const { surface, workspace } = cmux.addSession("s");
    await renameLive("s", "new name");
    expect(input(surface)).toEqual(["paste:/rename new name", "key:enter"]);
    expect(workspace.title).toBe("new name");
  });

  it("leaves a shared workspace's title alone", async () => {
    const { workspace } = cmux.addSession("s", { title: "shared" });
    cmux.addSurface(workspace);
    await renameLive("s", "new name");
    expect(cmux.calls("workspace.rename")).toEqual([]);
    expect(workspace.title).toBe("shared");
  });
});

describe("dispatch", () => {
  const dir = () =>
    realpathSync(mkdtempSync(join(tmpdir(), "seamux-dispatch-")));

  it("starts Claude Code in a new workspace through cmux's wrapper", async () => {
    const cwd = dir();
    const sessionId = await dispatch({ cwd, prompt: "Fix the login page" });

    const [create] = cmux.calls("workspace.create");
    expect(create.params).toMatchObject({
      cwd,
      title: "fix-the-login-page",
      focus: false,
    });
    const command = String(create.params.initial_command);
    // In the user's own interactive shell, so it gets their PATH.
    expect(command).toMatch(/^exec '[^']+' -ic '/);
    expect(command).toContain("cmux-claude-wrapper");
    expect(command).toContain(`--session-id`);
    expect(command).toContain(sessionId);
    expect(command).toContain("--name");
    expect(command).toContain("Fix the login page");
  });

  it("takes the next free name when a workspace already has it", async () => {
    cmux.addWorkspace({ title: "fix-the-login-page" });
    await dispatch({ cwd: dir(), prompt: "Fix the login page" });
    expect(cmux.calls("workspace.create")[0].params.title).toBe(
      "fix-the-login-page-2",
    );
  });

  it("answers the new-folder trust dialog, which nothing else reports", async () => {
    await dispatch({ cwd: dir(), prompt: "Trust me" });
    const created = cmux.workspaces.at(-1)!.surfaces[0];
    created.screen =
      "Do you trust the files in this folder?\n❯ 1. No, exit\n  2. Yes, I trust this folder";
    // Its default is "No, exit", so Down, then Enter.
    await vi.waitFor(
      () => expect(input(created)).toEqual(["key:down", "key:enter"]),
      {
        timeout: 5_000,
      },
    );
  });

  it("refuses an empty prompt before reaching cmux", async () => {
    await expect(dispatch({ cwd: dir(), prompt: "  " })).rejects.toThrow(
      "Say what the new session should do",
    );
    expect(cmux.calls("workspace.create")).toEqual([]);
  });
});
