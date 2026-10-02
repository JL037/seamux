import type { Route } from "./+types/restart";
import { assertFromBoard, assertLocalHost } from "~/lib/guard.server";
import { SEAMUX_HOME } from "~/lib/paths.server";
import { requestRestart } from "~/lib/restart.server";

// The way out for a board whose page renders but whose scripts don't run:
// every button is dead, so nothing on the board itself can start a session to
// fix it. A plain form asks the supervisor to restart the board server, which
// is what clears a dev server serving the browser modules it can't use, and
// the reply drops this browser's cached copies of them, as /reset does. Plain
// HTML with its own inline script, so it works when the board's don't.

function page(body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>seamux</title>
<style>body{font:16px system-ui,sans-serif;margin:4rem 1rem;text-align:center}button{font:inherit;padding:.6rem 1.2rem}</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
}

const ASK = page(`<p>Restart the board's server, and clear this browser's cache for the board?</p>
<p>Sessions keep running: only the board restarts.</p>
<form method="post"><button type="submit">Restart the board</button></form>
<p><a href="/">Back to the board</a></p>`);

// Waits for a server other than the one that took the request, then goes
// back to the board. A dev server takes a few seconds to come back, and
// longer when it re-bundles its dependencies.
const restarting = (boot: number) =>
  page(
    `<p id="status">Restarting the board…</p>
<p><a href="/">Back to the board</a></p>`,
    `<script>
(()=>{const old=${JSON.stringify(boot)};const until=Date.now()+120000;
const tick=async()=>{try{const r=await fetch("/restart?boot",{cache:"no-store"});if(r.ok){const {boot}=await r.json();if(boot!==old){location.replace("/");return}}}catch{}
if(Date.now()<until)setTimeout(tick,1000);else document.getElementById("status").textContent="The board hasn't come back yet. Check the terminal running seamux on the Mac."};
setTimeout(tick,1000)})()
</script>`,
  );

const HTML = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
};

export function loader({ request }: Route.LoaderArgs) {
  assertLocalHost(request);
  // Which server answered, so the page waiting on a restart can tell the
  // new one from the old.
  if (new URL(request.url).searchParams.has("boot")) {
    return Response.json(
      { boot: process.pid },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return new Response(ASK, { headers: HTML });
}

export function action({ request }: Route.ActionArgs) {
  assertFromBoard(request);
  requestRestart(SEAMUX_HOME);
  return new Response(restarting(process.pid), {
    headers: { ...HTML, "Clear-Site-Data": '"cache"' },
  });
}
