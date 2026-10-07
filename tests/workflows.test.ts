// The step outputs the workflows in .github/workflows write, read as the
// shell reads them. Ported from taskless/cli's
// .github/scripts/workflow-outputs.cjs, alongside the on-demand Claude
// workflows it guards.
//
// `echo 'key=value' >> "$GITHUB_OUTPUT"` is single-quoted because the review
// workflow's `focus=` strings hold backticks and `$`. An apostrophe in one
// closes the string early and turns the rest of the line into shell words,
// breaking every review mode at once, in hundreds of characters of prose on
// one line that nobody reads for quoting. And where a file compares an output
// against a literal (`steps.prep.outputs.mode != 'full'`), the literal must be
// a value the file writes, or the gate silently never matches.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const DIR = join(
  resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  ".github/workflows",
);

// Whole and correctly quoted. `[^']*` stops at an apostrophe in the value,
// and the redirect that must follow then fails to match.
const OUTPUT_LINE =
  /^echo '([A-Za-z_][A-Za-z0-9_]*)=([^']*)' >> "\$GITHUB_OUTPUT"$/;

// `steps.<id>.outputs.<key> == 'literal'`, or `!=`.
const OUTPUT_COMPARISON =
  /steps\.[A-Za-z0-9_-]+\.outputs\.([A-Za-z0-9_]+)\s*[!=]=\s*'([^']*)'/g;

function problems(source: string, name: string): string[] {
  const errors: string[] = [];
  const written = new Map<string, Set<string>>();

  for (const [index, raw] of source.split("\n").entries()) {
    const line = raw.trim();
    // Every single-quoted echo, not only those naming $GITHUB_OUTPUT: a value
    // wrapped onto a second line leaves the redirect on the line below.
    if (!line.startsWith("echo '")) continue;
    const where = `${name}:${index + 1}`;

    if ((line.match(/'/g) ?? []).length % 2 === 1) {
      errors.push(`${where}: unterminated single-quoted string: ${line}`);
      continue;
    }
    // A balanced echo into the log, such as `echo 'threads: 3'`.
    if (!line.includes("$GITHUB_OUTPUT")) continue;

    const match = OUTPUT_LINE.exec(line);
    if (!match) {
      errors.push(`${where}: malformed step output: ${line}`);
      continue;
    }
    const [, key, value] = match;
    written.set(key, (written.get(key) ?? new Set()).add(value));
  }

  for (const [, key, literal] of source.matchAll(OUTPUT_COMPARISON)) {
    const values = written.get(key);
    // Keys written some other way (an action's own outputs) have no ground
    // truth here.
    if (values && !values.has(literal)) {
      errors.push(
        `${name}: compares output '${key}' against '${literal}', which it never writes (${[...values].join(", ")})`,
      );
    }
  }
  return errors;
}

describe("workflow step outputs", () => {
  const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

  it.each(files)("%s writes and compares them cleanly", (file) => {
    expect(problems(readFileSync(join(DIR, file), "utf8"), file)).toEqual([]);
  });

  it("catches an apostrophe in a value", () => {
    const yml = `echo 'focus=don't' >> "$GITHUB_OUTPUT"`;
    expect(problems(yml, "x.yml")).toHaveLength(1);
  });

  it("catches a value wrapped onto the next line", () => {
    const yml = `echo 'focus=one\n  two' >> "$GITHUB_OUTPUT"`;
    expect(problems(yml, "x.yml")).toHaveLength(1);
  });

  it("catches a gate on a value never written", () => {
    const yml = [
      `echo 'mode=full' >> "$GITHUB_OUTPUT"`,
      `if: steps.prep.outputs.mode != 'ful'`,
    ].join("\n");
    expect(problems(yml, "x.yml")).toEqual([
      "x.yml: compares output 'mode' against 'ful', which it never writes (full)",
    ]);
  });
});
