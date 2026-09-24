import type { Root as HastRoot } from "hast";
import type { Code, Root } from "mdast";
import { common, createLowlight } from "lowlight";

// highlight.js's common languages, shared by the markdown renderer and the
// file viewer's raw view.
export const lowlight = createLowlight(common);

// Beyond this, a raw file is shown plain: highlighting it would stall the
// page.
export const HIGHLIGHT_LIMIT = 256 * 1024;

const BY_NAME: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
};

// The language to highlight a file as, from its name, or null for plain.
export function languageFor(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ext === "jsonl") return "json";
  if (ext === "md" || ext === "mdx") return "markdown";
  return ext && lowlight.registered(ext) ? ext : null;
}

const FRONTMATTER = /^(---\r?\n)([\s\S]*?\r?\n)(---(?:\r?\n|$))/;

// A file's text as highlighted HTML nodes. Markdown's grammar doesn't know
// frontmatter, and reads its underscores as emphasis, so that part is
// highlighted as the YAML it is.
export function highlightFile(language: string, text: string): HastRoot {
  const front = language === "markdown" ? FRONTMATTER.exec(text) : null;
  if (!front) return lowlight.highlight(language, text);
  const [all, open, yaml, close] = front;
  return {
    type: "root",
    children: [
      { type: "text", value: open },
      ...lowlight.highlight("yaml", yaml).children,
      { type: "text", value: close },
      ...lowlight.highlight("markdown", text.slice(all.length)).children,
    ],
  };
}

// A markdown file's YAML frontmatter, as a YAML code block at the top
// rather than a thematic break and a run-on paragraph.
export function remarkFrontmatterAsCode() {
  return (tree: Root) => {
    const first = tree.children[0];
    if (first?.type !== "yaml") return;
    const code: Code = {
      type: "code",
      lang: "yaml",
      value: first.value,
      data: { hProperties: { "data-frontmatter": "" } },
    };
    tree.children[0] = code;
  };
}
