import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { data } from "react-router";

import type { Route } from "./+types/file-raw";
import {
  contentType,
  readHead,
  resolveFile,
  SANDBOX_BASE,
} from "~/lib/files.server";
import { assertLocalHost, assertLocalRead } from "~/lib/guard.server";

// A file's bytes, for the viewer's images and its rendered-HTML frame. The
// path is the URL's own, `/file/raw/Users/…`, so relative links inside an
// HTML file resolve beside it. The same file under SANDBOX_BASE is for that
// frame, whose requests arrive cross-site. Every response is sandboxed: an
// HTML file opened here, framed or not, runs with an opaque origin and
// cannot act as the board. `?dl=1` asks the browser to save it instead.
export async function loader({ request }: Route.LoaderArgs) {
  const { pathname, searchParams } = new URL(request.url);
  let prefix = "/file/raw";
  if (pathname.startsWith(`${SANDBOX_BASE}/`)) {
    assertLocalHost(request);
    prefix = SANDBOX_BASE;
  } else if (pathname.startsWith("/file/raw/")) {
    assertLocalRead(request);
  } else {
    throw data("Forbidden", { status: 403 });
  }
  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    throw data("Bad path", { status: 400 });
  }
  const found = await resolveFile(path);
  if (!found || !found.stats.isFile()) {
    throw data("Not found", { status: 404 });
  }
  const type = contentType(found.path, await readHead(found.path, 8000));
  const body = Readable.toWeb(createReadStream(found.path)) as ReadableStream;
  const headers = new Headers({
    "Content-Type": type,
    "Content-Length": String(found.stats.size),
    "Content-Security-Policy": "sandbox allow-scripts allow-popups",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  if (searchParams.get("dl") === "1") {
    const name = found.path.split("/").pop() ?? "file";
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  }
  return new Response(body, { headers });
}
