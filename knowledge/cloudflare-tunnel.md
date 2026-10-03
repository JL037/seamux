# Cloudflare Tunnel

Reaching the board from anywhere through a Cloudflare Tunnel, behind Cloudflare Access. The supervisor runs `cloudflared` beside the board, and every request through it must carry an Access token the board verifies itself. Measured against cloudflared 2026.9.3, with a tunnel managed from the dashboard. [docs/remote-connections.md](../docs/remote-connections.md) is the setup guide; this page is why it's built the way it is.

In seamux: `remoteGate`, `checkTunnelRequest` and `verifyAccessToken` in [remote.server.ts](../app/lib/remote.server.ts), and the supervisor in [scripts/supervise.ts](../scripts/supervise.ts).

## The origin sees the public hostname as `Host`

Vite's host check refused `seamux.technein.com` until it was in `allowedHosts`, so the guard matches the tunnel's hostname, not `localhost`.

- **Measured:** cloudflared 2026.9.3.
- **In seamux:** `allowedHosts` in [vite.config.ts](../vite.config.ts), and `isTunnelHost` in [remote.server.ts](../app/lib/remote.server.ts).
- **See also:** [cloudflared forwards over http, so React Router refuses actions](#cloudflared-forwards-over-http-so-react-router-refuses-actions).

## The ingress comes from the dashboard, not the token

`cloudflared tunnel run` with only `TUNNEL_TOKEN` set logs the dashboard's config on connect (`Updated to new configuration config=...`), including the local service each hostname points at. The token goes in the environment, so it stays out of `ps`.

- **Measured:** cloudflared 2026.9.3.
- **In seamux:** [scripts/supervise.ts](../scripts/supervise.ts).

## A bad token exits with code 255 at once

cloudflared prints "Provided Tunnel token is not valid", so the supervisor backs off rather than spinning.

- **Measured:** cloudflared 2026.9.3.
- **In seamux:** [scripts/supervise.ts](../scripts/supervise.ts), which restarts what exits with a doubling backoff.

## cloudflared forwards over http, so React Router refuses actions

The dev server builds `request.url` as `http://<hostname>`, the browser sends `Origin: https://<hostname>`, and React Router's CSRF check answers every action the board sends, a `.data` request, with "Bad Request" until the hostname is in `allowedActionOrigins` in `react-router.config.ts`.

- **Measured:** cloudflared 2026.9.3.
- **In seamux:** `allowedActionOrigins` in [react-router.config.ts](../react-router.config.ts) and in [server/serve.ts](../server/serve.ts); `assertFromBoard` in [guard.server.ts](../app/lib/guard.server.ts) still requires the Origin to be exactly `https://<hostname>`.
- **See also:** [React Router checks a POST's Origin only on its `.data` requests, never on a plain POST to a resource route](vite-and-react-router.md#react-router-checks-a-posts-origin-only-on-its-data-requests-never-on-a-plain-post-to-a-resource-route).

## A renamed team keeps its old issuer

After renaming a Zero Trust team, a login made before the rename still reached the board, and its token's `iss` still named the old team domain. The new domain's certs endpoint serves the old signing key alongside a new one, and the old domain's endpoint 404s. The board checks the key and the AUD, not `iss`.

- **Measured:** cloudflared 2026.9.3.
- **In seamux:** `verifyAccessToken` and `fetchKeys` in [remote.server.ts](../app/lib/remote.server.ts).

## Access's sign-out page errors without a cookie

`/cdn-cgi/access/logout`, on the application's hostname or the team domain, answers "No Access cookie found. Please login first." on an error page, so it's no help as a recovery link.

- **Measured:** cloudflared 2026.9.3.
- **In seamux:** `forbiddenPage` in [remote.server.ts](../app/lib/remote.server.ts), which doesn't offer it.

## A tunnel with no Access application is wide open

Without one, a request reached the Mac with no login at all. Access is set up separately from the tunnel, which is why the board checks the Access token itself.

- **Measured:** cloudflared 2026.9.3.
- **In seamux:** `checkTunnelRequest` and `verifyAccessToken` in [remote.server.ts](../app/lib/remote.server.ts), in both `remoteGate` and the auth middleware. [CLAUDE.md](../CLAUDE.md) makes it a rule.

## Cloudflare's edge kept a stylesheet the board had changed

After a landing changed `app.css` without moving the stamp Vite puts on its import (see [Vite doesn't always move an import's `?t=` stamp](vite-and-react-router.md#vite-doesnt-always-move-an-imports-t-stamp)), a browser on the tunnel's hostname got the new page and the old stylesheet, stuck through full reloads, while `localhost` served the new one under the same URL. Vite answers with `Cache-Control: no-cache`; Cloudflare caches by extension, `.css` and `.js` among them, and a browser's reload doesn't reach past the edge. Not measured: the `cf-cache-status` of the stale response, since Access stands in front of every request from here.

- **Measured:** cloudflared 2026.9.3, Vite 8.3.0, React Router 7.18.4.
- **In seamux:** `remoteGate` in [remote.server.ts](../app/lib/remote.server.ts) sends `Cloudflare-CDN-Cache-Control: no-store` with everything it answers through the tunnel, which the edge reads ahead of `Cache-Control`. What the edge already holds stays until it expires or is purged, which `bustStylesheet` in [vite.config.ts](../vite.config.ts) gets past for the stylesheet.

