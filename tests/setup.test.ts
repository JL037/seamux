// What seamux installs outside itself (scripts/setup.ts), which the board
// does on every start: the hooks in ~/.claude/settings.json and the dispatch
// skill. Each test gets a home of its own, so none touches the real one.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { ensureSetup, setup, uninstall, uninstalled } from "../scripts/setup";

let home: string;
const settingsPath = () => join(home, ".claude/settings.json");
const settings = () => JSON.parse(readFileSync(settingsPath(), "utf8"));
const skillPath = () => join(home, ".claude/skills/seamux-dispatch/SKILL.md");
const writeSettings = (value: unknown) => {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(value));
};
// The hook command each event runs, ours or not.
const commands = (event: string) =>
  (settings().hooks?.[event] ?? []).flatMap(
    (g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command),
  );

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "seamux-home-"));
  process.env.HOME = home;
  rmSync(join(process.env.SEAMUX_HOME!, ".seamux.json"), { force: true });
});

describe("ensureSetup, on every start", () => {
  it("installs the hooks and the skill on a first run, and says so", () => {
    const result = ensureSetup();
    expect(result).toMatchObject({ state: "ready" });
    expect(result.state === "ready" && result.changed).toMatch(
      /^Installed the subagent hooks in .*settings\.json .* and the seamux-dispatch skill\. `bin\/seamux uninstall` removes them\.$/,
    );
    for (const event of ["SubagentStart", "SubagentStop"]) {
      expect(commands(event)).toEqual([
        expect.stringMatching(/ --no-warnings .*\/hooks\/subagent-event\.ts$/),
      ]);
    }
    const skill = readFileSync(skillPath(), "utf8");
    expect(skill).toContain("<!-- installed by seamux: npm run skills:install -->");
    expect(skill).not.toContain("{{SEAMUX_BIN}}");
  });

  it("changes nothing, and says nothing, once set up", () => {
    ensureSetup();
    const before = readFileSync(settingsPath(), "utf8");
    rmSync(`${settingsPath()}.seamux-backup`, { force: true });
    expect(ensureSetup()).toEqual({ state: "ready", changed: null });
    expect(readFileSync(settingsPath(), "utf8")).toBe(before);
    // Not even rewritten, so no backup either.
    expect(existsSync(`${settingsPath()}.seamux-backup`)).toBe(false);
  });

  it("keeps the user's own settings and hooks, and backs the file up", () => {
    writeSettings({
      model: "opus",
      hooks: {
        SubagentStart: [{ hooks: [{ type: "command", command: "echo mine" }] }],
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      },
    });
    ensureSetup();
    expect(settings().model).toBe("opus");
    expect(commands("SubagentStart")).toEqual([
      "echo mine",
      expect.stringMatching(/subagent-event\.ts$/),
    ]);
    expect(commands("Stop")).toEqual(["echo stop"]);
    expect(
      JSON.parse(readFileSync(`${settingsPath()}.seamux-backup`, "utf8")).model,
    ).toBe("opus");
  });

  it("replaces a hook left by an older seamux instead of adding a second", () => {
    const old = "/old/node --no-warnings /old/seamux/hooks/subagent-event.ts";
    writeSettings({
      hooks: {
        SubagentStart: [{ hooks: [{ type: "command", command: old }] }],
        SubagentStop: [{ hooks: [{ type: "command", command: old }] }],
      },
    });
    const result = ensureSetup();
    expect(result.state === "ready" && result.changed).toMatch(/subagent hooks/);
    expect(commands("SubagentStart")).toHaveLength(1);
    expect(commands("SubagentStart")[0]).not.toBe(old);
  });

  it("leaves alone a skill of the same name that seamux didn't write", () => {
    mkdirSync(join(home, ".claude/skills/seamux-dispatch"), { recursive: true });
    writeFileSync(skillPath(), "someone else's skill\n");
    ensureSetup();
    expect(readFileSync(skillPath(), "utf8")).toBe("someone else's skill\n");
  });

  it("starts anyway when settings.json isn't valid JSON, and leaves it alone", () => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(settingsPath(), "{ not json");
    expect(ensureSetup()).toEqual({
      state: "failed",
      error: `${settingsPath()} isn't valid JSON, so seamux left it alone`,
    });
    expect(readFileSync(settingsPath(), "utf8")).toBe("{ not json");
  });
});

describe("uninstall and setup", () => {
  it("uninstall removes only seamux's hooks and skill, and remembers it", () => {
    writeSettings({
      hooks: {
        SubagentStart: [{ hooks: [{ type: "command", command: "echo mine" }] }],
      },
    });
    ensureSetup();
    expect(uninstall()).toMatch(
      /^Removed .* The board won't start until `bin\/seamux setup`\.$/,
    );
    expect(commands("SubagentStart")).toEqual(["echo mine"]);
    expect(commands("SubagentStop")).toEqual([]);
    expect(existsSync(skillPath())).toBe(false);
    expect(uninstalled()).toBe(true);
  });

  it("after uninstall, a start installs nothing", () => {
    ensureSetup();
    uninstall();
    expect(ensureSetup()).toEqual({ state: "uninstalled" });
    expect(commands("SubagentStart")).toEqual([]);
    expect(existsSync(skillPath())).toBe(false);
  });

  it("setup reinstalls, and starts checking again", () => {
    ensureSetup();
    uninstall();
    expect(setup()).toMatch(/^Installed /);
    expect(uninstalled()).toBe(false);
    expect(ensureSetup()).toEqual({ state: "ready", changed: null });
    expect(setup()).toBe("seamux is already set up.");
  });
});

describe("the board after uninstall", () => {
  it("says how to reinstall, and doesn't start", () => {
    mkdirSync(process.env.SEAMUX_HOME!, { recursive: true });
    writeFileSync(
      join(process.env.SEAMUX_HOME!, ".seamux.json"),
      JSON.stringify({ uninstalled: true }),
    );
    const supervise = fileURLToPath(
      new URL("../scripts/supervise.ts", import.meta.url),
    );
    const run = spawnSync(process.execPath, ["--no-warnings", supervise], {
      env: process.env,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe(
      "seamux was uninstalled. Run `bin/seamux setup` to reinstall its hooks and skill.",
    );
    // It stopped before claiming the board.
    expect(
      existsSync(join(process.env.SEAMUX_HOME!, "data/serve.pid")),
    ).toBe(false);
  });
});
