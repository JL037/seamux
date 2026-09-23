// Installs (or with --uninstall, removes) seemux's skills in
// ~/.claude/skills, so sessions in any repo can use the protocol. Each
// SKILL.md is rendered with this checkout's bin/seemux path. Idempotent.
//
//   npm run skills:install
//   npm run skills:uninstall

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO, "skills");
const TARGET = join(homedir(), ".claude/skills");
const BIN = join(REPO, "bin/seemux");
// Marks a skill as ours, so uninstall never removes one it did not write.
const MARK = "<!-- installed by seemux: npm run skills:install -->";

const uninstall = process.argv.includes("--uninstall");

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
    console.log(`Skipped ${dest}: a skill seemux did not install is there`);
    continue;
  }
  const body = readFileSync(join(SOURCE, name, "SKILL.md"), "utf8")
    .replaceAll("{{SEEMUX_BIN}}", BIN)
    .trimEnd();
  mkdirSync(dest, { recursive: true });
  writeFileSync(file, `${body}\n\n${MARK}\n`);
  console.log(`Installed ${file}`);
}
