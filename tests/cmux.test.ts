// The wire contract with cmux's control socket (app/lib/cmux.server.ts): how
// seamux frames a request, authenticates, and reads the reply.

import { createServer } from "node:net";
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CmuxError, cmuxCli, cmuxRpc, cmuxTrouble } from "~/lib/cmux.server";
import { FakeCmux } from "./fake-cmux";

let cmux: FakeCmux;

beforeEach(async () => {
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
});

afterEach(async () => {
  delete process.env.CMUX_SOCKET_CAPABILITY;
  delete process.env.CMUX_SOCKET_PASSWORD;
  await cmux.stop();
});

describe("cmuxRpc", () => {
  it("sends the method and params, and returns the result", async () => {
    const w = cmux.addWorkspace({ title: "one", cwd: "/work" });
    const result = await cmuxRpc("workspace.list");
    expect(result).toEqual({
      workspaces: [
        { id: w.id, ref: w.ref, title: "one", current_directory: "/work" },
      ],
    });
    expect(cmux.requests).toEqual([
      { method: "workspace.list", params: {}, capability: null },
    ]);
  });

  it("carries the capability token cmux gave this terminal", async () => {
    cmux.capability = "v1.payload.signature";
    process.env.CMUX_SOCKET_CAPABILITY = "v1.payload.signature";
    await expect(cmuxRpc("system.ping")).resolves.toEqual({ pong: true });
    expect(cmux.requests[0].capability).toBe("v1.payload.signature");
  });

  it("is refused without the capability token cmux requires", async () => {
    cmux.capability = "v1.payload.signature";
    await expect(cmuxRpc("system.ping")).rejects.toThrow(/unauthorized/);
  });

  it("authenticates with the socket password first", async () => {
    cmux.password = "hunter2";
    process.env.CMUX_SOCKET_PASSWORD = "hunter2";
    await expect(cmuxRpc("system.ping")).resolves.toEqual({ pong: true });
  });

  it("says so when cmux refuses the password", async () => {
    cmux.password = "hunter2";
    process.env.CMUX_SOCKET_PASSWORD = "wrong";
    await expect(cmuxRpc("system.ping")).rejects.toThrow(
      "cmux system.ping: refused the socket password: ERROR: Invalid password (password)",
    );
  });

  it("turns a refusal into a CmuxError carrying cmux's code", async () => {
    const err = (await cmuxRpc("no.such_method").catch((e) => e)) as CmuxError;
    expect(err).toBeInstanceOf(CmuxError);
    expect(err).toMatchObject({ method: "no.such_method", code: "method_not_found" });
    expect(err.message).toBe("cmux no.such_method: Unknown method (method_not_found)");
  });

  it("names cmux's refusal of a process it didn't start", async () => {
    cmux.outsideCmux = true;
    const err = (await cmuxRpc("system.ping").catch((e) => e)) as CmuxError;
    expect(err).toBeInstanceOf(CmuxError);
    expect(err.code).toBe("access_denied");
    expect(cmuxTrouble(err)).toBe("outside_cmux");
  });

  it("fails when nothing listens on the socket", async () => {
    await cmux.stop();
    await expect(cmuxRpc("system.ping")).rejects.toThrow(/^cmux system\.ping: /);
    await cmux.start();
  });

  it("reads a reply split across writes, and skips replies to other ids", async () => {
    // A server of its own, to control exactly how the bytes arrive.
    const path = `${process.env.CMUX_SOCKET_PATH}.raw`;
    rmSync(path, { force: true });
    const server = createServer((socket) => {
      socket.on("data", (data) => {
        const { id } = JSON.parse(String(data));
        socket.write('{"id":"someone-else","ok":true,"result":1}\n{"id":');
        setTimeout(() => socket.write(`"${id}","ok":true,"result":{"n":2}}\n`), 20);
      });
    });
    await new Promise<void>((r) => server.listen(path, r));
    const saved = process.env.CMUX_SOCKET_PATH;
    process.env.CMUX_SOCKET_PATH = path;
    try {
      await expect(cmuxRpc("anything")).resolves.toEqual({ n: 2 });
    } finally {
      process.env.CMUX_SOCKET_PATH = saved;
      await new Promise((r) => server.close(r));
    }
  });
});

describe("cmuxCli", () => {
  it("runs `cmux sessions list` from PATH", async () => {
    cmux.addSession("s-1");
    const listed = JSON.parse(await cmuxCli(["sessions", "list", "--json"]));
    expect(listed.sessions.map((s: { session_id: string }) => s.session_id)).toEqual(["s-1"]);
  });
});
