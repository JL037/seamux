// Installs (or with --uninstall, removes) seamux's skills in
// ~/.claude/skills, so sessions in any repo can use the protocol. Each
// SKILL.md is rendered with the path of the seamux command sessions call
// (app/lib/paths.server.ts). Idempotent.
//
//   npm run skills:install      (or `seamux setup`)
//   npm run skills:uninstall    (or `seamux uninstall`)

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { packagePath, SEAMUX_BIN } from "../app/lib/paths.server.ts";
import { installRuntime } from "./runtime.ts";

const SOURCE = packagePath("skills");
const TARGET = join(homedir(), ".claude/skills");
// Marks a skill as ours, so uninstall never removes one it did not write.
const MARK = "<!-- installed by seamux: npm run skills:install -->";

const uninstall = process.argv.includes("--uninstall");
if (!uninstall) installRuntime();

for (const name of readdirSync(SOURCE)) {
  const dest = join(TARGET, name);
  const file = join(dest, "SKILL.md");
  if (uninstall) {
    if (existsSync(file) && readFileSync(file, "utf8").includes(MARK)) {
      rmSync(dest, { recursive: true });
      console.log(`Removed ${dest}`);
    }
    continue;
  }
  if (existsSync(file) && !readFileSync(file, "utf8").includes(MARK)) {
    console.log(`Skipped ${dest}: a skill seamux did not install is there`);
    continue;
  }
  const body = readFileSync(join(SOURCE, name, "SKILL.md"), "utf8")
    .replaceAll("{{SEAMUX_BIN}}", SEAMUX_BIN)
    .trimEnd();
  mkdirSync(dest, { recursive: true });
  writeFileSync(file, `${body}\n\n${MARK}\n`);
  console.log(`Installed ${file}`);
}
