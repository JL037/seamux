// Runs before each test file's modules load, so everything seamux reads at
// import (SEAMUX_HOME, the socket path) points at the test's own copies.
//
// Above all, no test may reach the real cmux: running the suite from a cmux
// terminal inherits its socket path and capability token, and a request that
// got through would type into a live session. So the socket path is always
// replaced, and the token and password removed.

import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "seamux-test-"));
const bin = fileURLToPath(new URL("./bin", import.meta.url));

process.env.SEAMUX_HOME = join(root, "home");
// A home of its own, so no test reads the real ~/.claude or ~/.codex, or
// writes the real ~/.claude/settings.json.
process.env.HOME = join(root, "user");
process.env.CODEX_HOME = join(root, "user/.codex");
// Unix socket paths are limited to about 100 bytes, so this one stays short.
process.env.CMUX_SOCKET_PATH = join(tmpdir(), `smx-${process.pid}.sock`);
delete process.env.CMUX_SOCKET;
delete process.env.CMUX_SOCKET_CAPABILITY;
delete process.env.CMUX_SOCKET_PASSWORD;
process.env.SEAMUX_TEST_CMUX_STATE = join(root, "cmux-sessions.json");
process.env.SEAMUX_TEST_CLAUDE_AGENTS = join(root, "claude-agents.json");
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
mkdirSync(process.env.HOME, { recursive: true });
// cmux's app bundle, which seamux runs the `cmux` command from when it isn't
// on PATH, holds the fake one too, so no test runs the real one. Never an
// app: a test stays inside its sandbox, and macOS takes an unsigned folder
// shaped like cmux.app for cmux itself and tells the user it's damaged.
process.env.SEAMUX_CMUX_APP = join(root, "cmux-app");
const bundled = join(process.env.SEAMUX_CMUX_APP, "Contents/Resources/bin");
mkdirSync(bundled, { recursive: true });
copyFileSync(join(bin, "cmux"), join(bundled, "cmux"));
