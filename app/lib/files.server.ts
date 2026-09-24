// Reads a file on disk for the /file viewer. Read-only, like everything
// else here: nothing in this module writes, moves or deletes.

import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";

// A rendered HTML page runs sandboxed, in an opaque origin, so its own
// stylesheets and scripts arrive as cross-site requests with no Referer:
// indistinguishable from another website's. They are let through by this
// secret in their path instead, which the page's relative URLs inherit and
// no other site can know. A new one each time the server starts.
export const SANDBOX_BASE = `/file/sandbox/${randomBytes(16).toString("hex")}`;

// Beyond this, the viewer shows the start and says so.
const TEXT_LIMIT = 2 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export type FileKind = "markdown" | "html" | "image" | "text" | "binary";

export type FileEntry =
  | {
      type: "file";
      path: string;
      kind: FileKind;
      size: number;
      text: string | null;
      truncated: boolean;
      mtime: number;
    }
  | { type: "directory"; path: string; entries: DirEntry[]; mtime: number };

export type DirEntry = { name: string; directory: boolean };

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

// Replies cite code as `app/root.tsx:12` or `:12:4`. When that isn't a
// file, the path without the line is.
export async function resolveFile(
  raw: string,
): Promise<{ path: string; stats: Stats } | null> {
  const path = expandHome(raw);
  if (!path.startsWith("/")) return null;
  const stats = await statOrNull(path);
  if (stats) return { path, stats };
  const bare = path.replace(/:\d+(:\d+)?$/, "");
  if (bare === path) return null;
  const bareStats = await statOrNull(bare);
  return bareStats ? { path: bare, stats: bareStats } : null;
}

export function contentType(path: string, sample: Buffer): string {
  return (
    TYPES[extname(path).toLowerCase()] ??
    (isBinary(sample) ? "application/octet-stream" : "text/plain; charset=utf-8")
  );
}

function isBinary(sample: Buffer): boolean {
  return sample.subarray(0, 8000).includes(0);
}

function kindOf(path: string, sample: Buffer): FileKind {
  const type = contentType(path, sample);
  if (type.startsWith("text/markdown")) return "markdown";
  if (type.startsWith("text/html")) return "html";
  if (type.startsWith("image/")) return "image";
  if (
    type.startsWith("text/") ||
    type.startsWith("application/json") ||
    !isBinary(sample)
  ) {
    return "text";
  }
  return "binary";
}

export async function readHead(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function loadFile(raw: string): Promise<FileEntry | null> {
  const found = await resolveFile(raw);
  if (!found) return null;
  const { path, stats } = found;
  if (stats.isDirectory()) {
    const dirents = await readdir(path, { withFileTypes: true });
    const entries = dirents
      .map((d) => ({ name: d.name, directory: d.isDirectory() }))
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
    return { type: "directory", path, entries, mtime: stats.mtimeMs };
  }
  if (!stats.isFile()) return null;
  const size = stats.size;
  const head = await readHead(path, Math.min(size, TEXT_LIMIT));
  const kind = kindOf(path, head);
  const textual = kind === "markdown" || kind === "html" || kind === "text";
  return {
    type: "file",
    path,
    kind,
    size,
    text: textual ? head.toString("utf8") : null,
    truncated: textual && size > TEXT_LIMIT,
    mtime: stats.mtimeMs,
  };
}
