// Runs the board as a launchd agent: started at login, restarted if it
// dies, serving the dev server from this checkout so merged changes go live
// through Vite's hot reload without a restart.
//
//   npm run service:install     write the agent and start it
//   npm run service:restart     restart it (after a dependency change)
//   npm run service:status      is it running
//   npm run service:uninstall   stop it and remove the agent

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "com.seemux.board";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLIST = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const LOG = join(REPO, "data/logs/board.log");
const DOMAIN = `gui/${userInfo().uid}`;

// launchd starts with a bare PATH. The board shells out to claude, cmux and
// node, so name their directories explicitly.
function servicePath(): string {
  const node = execFileSync("/bin/sh", ["-lc", "command -v node"], {
    encoding: "utf8",
  }).trim();
  return [
    join(homedir(), ".local/bin"),
    dirname(node),
    "/Applications/cmux.app/Contents/Resources/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
}

const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function plist(path: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>exec npm run dev</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(REPO)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(path)}</string>
    <key>HOME</key><string>${xml(homedir())}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`;
}

function launchctl(...args: string[]): string {
  return execFileSync("launchctl", args, { encoding: "utf8" });
}

function loaded(): boolean {
  try {
    launchctl("print", `${DOMAIN}/${LABEL}`);
    return true;
  } catch {
    return false;
  }
}

export function restart() {
  launchctl("kickstart", "-k", `${DOMAIN}/${LABEL}`);
}

function main(command: string | undefined) {
  if (command === "install") {
    if (loaded()) launchctl("bootout", `${DOMAIN}/${LABEL}`);
    mkdirSync(dirname(LOG), { recursive: true });
    mkdirSync(dirname(PLIST), { recursive: true });
    writeFileSync(PLIST, plist(servicePath()));
    launchctl("bootstrap", DOMAIN, PLIST);
    console.log(
      `Installed ${PLIST}\nBoard: http://127.0.0.1:5173  Log: ${LOG}`,
    );
  } else if (command === "uninstall") {
    if (loaded()) launchctl("bootout", `${DOMAIN}/${LABEL}`);
    if (existsSync(PLIST)) rmSync(PLIST);
    console.log(`Removed ${LABEL}`);
  } else if (command === "restart") {
    restart();
    console.log(`Restarted ${LABEL}`);
  } else if (command === "status") {
    if (!loaded()) {
      console.log(`${LABEL} is not installed`);
      return;
    }
    const info = launchctl("print", `${DOMAIN}/${LABEL}`);
    const state = info.match(/^\s*state = (.*)$/m)?.[1] ?? "unknown";
    const pid = info.match(/^\s*pid = (\d+)$/m)?.[1] ?? "none";
    console.log(`${LABEL}: ${state}, pid ${pid}. Log: ${LOG}`);
  } else {
    console.log("usage: service.ts install | restart | status | uninstall");
    process.exit(64);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);
