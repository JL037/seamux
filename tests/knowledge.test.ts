// knowledge/, what seamux has measured of the tools it stands on. Its pages
// link to each other by heading and to the code by path, and a renamed
// heading or a moved file breaks those links silently, so they are checked
// here. knowledge/index.md says how the collection is kept.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "knowledge");
const pages = readdirSync(DIR).filter((f) => f.endsWith(".md"));
const read = (path: string) => readFileSync(path, "utf8");

// The pages that aren't domains of findings, whose headings aren't entries.
const NOT_DOMAINS = new Set(["index.md", "measuring.md"]);

// Markdown outside fenced code blocks, where an example link isn't one.
const prose = (text: string) => text.replace(/^```[\s\S]*?^```/gm, "");

// A heading's anchor, as GitHub makes it.
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/ /g, "-");

const headings = (text: string) =>
  [...prose(text).matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1]);

describe("knowledge/", () => {
  it.each(pages)("%s links only to files and headings that exist", (page) => {
    const broken: string[] = [];
    const links = prose(read(join(DIR, page))).matchAll(
      /\]\(([^)\s]+)\)/g,
    );
    for (const [, href] of links) {
      if (/^[a-z]+:/.test(href)) continue;
      const [path, anchor] = href.split("#");
      const target = path ? resolve(DIR, path) : join(DIR, page);
      if (!existsSync(target)) {
        broken.push(href);
        continue;
      }
      if (anchor && !headings(read(target)).map(slug).includes(anchor))
        broken.push(href);
    }
    expect(broken).toEqual([]);
  });

  it.each(pages.filter((p) => !NOT_DOMAINS.has(p)))(
    "%s says what each entry was measured on",
    (page) => {
      const entries = prose(read(join(DIR, page))).split(/^## /m).slice(1);
      const unmeasured = entries
        .filter((e) => !e.includes("- **Measured:**"))
        .map((e) => e.split("\n")[0]);
      expect(unmeasured).toEqual([]);
    },
  );

  it("lists every page in the index", () => {
    const index = read(join(DIR, "index.md"));
    const missing = pages.filter(
      (p) => p !== "index.md" && !index.includes(`](${p})`),
    );
    expect(missing).toEqual([]);
  });
});
