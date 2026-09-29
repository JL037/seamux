// Bundles what runs under plain Node into dist/, one file per entry, for an
// installed package: Node won't strip types from files under node_modules.
// `npm run build` runs it after `react-router build`.
//
// npm packages stay imports, resolved from the package's node_modules. The
// hook and the CLI must import none, since the supervisor copies them out of
// the package (scripts/runtime.ts), so this fails if either does.

import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "rolldown";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRIES = {
  serve: "server/serve.ts",
  supervise: "scripts/supervise.ts",
  seamux: "scripts/seamux.ts",
  "subagent-event": "hooks/subagent-event.ts",
  "install-hooks": "scripts/install-hooks.ts",
  "install-skills": "scripts/install-skills.ts",
};
const STANDALONE = ["seamux", "subagent-event"];

rmSync(join(ROOT, "dist"), { recursive: true, force: true });
// One build per entry, so each is a single file with no shared chunks, and a
// copy of it runs on its own.
for (const [name, input] of Object.entries(ENTRIES)) {
  await build({
    cwd: ROOT,
    input,
    platform: "node",
    // Bare specifiers are npm packages or node: builtins.
    external: (id) => /^[^./~]/.test(id),
    resolve: { alias: { "~": join(ROOT, "app") } },
    output: {
      file: join(ROOT, "dist", `${name}.js`),
      format: "esm",
      codeSplitting: false,
    },
    logLevel: "warn",
  });
}

for (const name of STANDALONE) {
  const code = readFileSync(join(ROOT, "dist", `${name}.js`), "utf8");
  const packages = [...code.matchAll(/from\s+["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((id) => !id.startsWith("node:"));
  if (packages.length > 0) {
    throw new Error(
      `dist/${name}.js imports ${packages.join(", ")}, but it must run outside the package`,
    );
  }
}

console.log(`Bundled ${Object.keys(ENTRIES).length} entries into dist/`);
