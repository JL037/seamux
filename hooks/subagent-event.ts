// SubagentStart / SubagentStop hook. Installed globally by
// scripts/install-hooks.ts, so it runs inside every Claude Code session.
//
// It must never get in a session's way: it reads the payload, records it,
// and exits 0 whatever happens.

import { recordHook, type HookPayload } from "../app/lib/store.server.ts";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    recordHook(JSON.parse(input) as HookPayload);
  } catch (err) {
    process.stderr.write(`seemux hook: ${(err as Error).message}\n`);
  }
  process.exit(0);
});
