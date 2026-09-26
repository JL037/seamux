import type { Route } from "./+types/reset";
import { assertLocalHost } from "~/lib/guard.server";

// The way out for a browser stuck on the board's error page: it drops this
// browser's cached copies of the board's files and goes back to the board.
// Drafts, settings and the Access login are kept: only "cache" is cleared.
// A plain link reaches it, so it works when React is what broke.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="1;url=/">
<title>seamux</title>
<style>body{font:16px system-ui,sans-serif;margin:4rem 1rem;text-align:center}</style>
</head>
<body>
<p>Cleared this browser's cache for the board.</p>
<p><a href="/">Back to the board</a></p>
</body>
</html>`;

export function loader({ request }: Route.LoaderArgs) {
  assertLocalHost(request);
  return new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Clear-Site-Data": '"cache"',
      "Cache-Control": "no-store",
    },
  });
}
