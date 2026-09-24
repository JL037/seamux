// Links from Claude's replies to files on disk. A reply writes
// `./app/root.tsx` or `/Users/…/README.md`; the board would resolve that
// against its own URL, so it becomes a link to the /file viewer instead.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// `style.css:12` has the shape of a scheme, but is a path and a line.
const LINE_SUFFIX = /^[^:/]+:\d+(:\d+)?$/;

// `a/./b/../c` as `a/c`, keeping a leading `/` or `~/`.
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "~") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  const joined = out.join("/");
  return path.startsWith("/") ? `/${joined}` : joined;
}

export function dirnameOf(path: string): string {
  return path.replace(/\/[^/]*$/, "") || "/";
}

// The path a link points at, resolved against `base` (the session's
// directory, or the directory of the file being viewed), or null when the
// link is a web URL or an anchor.
export function linkedPath(href: string, base: string): string | null {
  if (href === "" || href.startsWith("#")) return null;
  let path: string;
  if (href.startsWith("file:")) {
    try {
      path = decodeURIComponent(new URL(href).pathname);
    } catch {
      return null;
    }
  } else if (SCHEME.test(href) && !LINE_SUFFIX.test(href)) {
    return null;
  } else {
    path = href.replace(/[?#].*$/, "");
    try {
      path = decodeURIComponent(path);
    } catch {}
  }
  if (path === "") return null;
  if (path.startsWith("/") || path === "~" || path.startsWith("~/")) {
    return normalize(path);
  }
  return normalize(`${base}/${path}`);
}

export type FileView = "raw" | "rendered";

export function fileViewerUrl(path: string, view?: FileView): string {
  const params = new URLSearchParams({ path });
  if (view) params.set("view", view);
  return `/file?${params}`;
}

// The file's bytes, at a URL whose path mirrors the file's, so that a
// rendered page's relative `style.css` or `img/a.png` resolves beside it.
// `base` is `/file/raw` for the board's own requests, or the viewer's
// sandbox base for a rendered HTML page, whose requests arrive cross-site.
export function fileRawUrl(path: string, base = "/file/raw"): string {
  return `${base}${path.split("/").map(encodeURIComponent).join("/")}`;
}
