# Vite and React Router

The board's own web stack: the dev server the supervisor runs from a checkout, the compiled server (`server/serve.ts`) an installed package runs, and the browsers that load them. Measured on macOS 26.5.1 with Vite 8.3.0 and React Router 7.18.4 unless an entry says otherwise.

Entries about the web stack that live in other domains:

- [The origin sees the public hostname as `Host`](cloudflare-tunnel.md#the-origin-sees-the-public-hostname-as-host): Vite's `allowedHosts`.
- [cloudflared forwards over http, so React Router refuses actions](cloudflare-tunnel.md#cloudflared-forwards-over-http-so-react-router-refuses-actions): `allowedActionOrigins`.
- [Vite's `host: true` listens on `*` over IPv6, dual-stack](mdns.md#vites-host-true-listens-on--over-ipv6-dual-stack).

## React Router's dev server copies `.env` into `process.env`, and never takes a variable back out

It calls `Object.assign(process.env, loadEnv(...))` from its plugin's `config` hook, at startup and again when Vite restarts itself over a changed `.env`. That hook runs after `vite.config.ts` is evaluated, in the same process, so a variable deleted from `.env` stayed set until the process exited.

- **Measured:** Vite 8.3.0, React Router 7.18.4.
- **In seamux:** `forgetDotenv` in [credentials.ts](../app/lib/credentials.ts), called at the top of [vite.config.ts](../vite.config.ts), clears every `SEAMUX_` variable the dev server's own environment didn't set, before each load.

## React Router refuses a cross-origin POST before any action runs

It answers with a 400, rather than `assertFromBoard`'s 403.

- **Measured:** React Router version not recorded.
- **In seamux:** `assertFromBoard` in [guard.server.ts](../app/lib/guard.server.ts), which still runs on every action React Router lets through.
- **See also:** [cloudflared forwards over http, so React Router refuses actions](cloudflare-tunnel.md#cloudflared-forwards-over-http-so-react-router-refuses-actions).

## Vite serves its pre-bundled dependencies as immutable

They go out as `Cache-Control: max-age=31536000,immutable`. Safari on an iPhone keeps them and doesn't ask for them again on a reload. After the board restarted and re-bundled, the phone's page failed on every render with `null is not an object (evaluating 'dispatcher.useContext')`, two copies of React, and reloading a dozen times didn't clear it. Vite answers a revalidation with a 304, so asking costs little.

- **Measured:** macOS 26.5.1, Vite 8.3.0, React Router 7.18.4, Safari on iOS.
- **In seamux:** the `revalidateDeps` plugin in [vite.config.ts](../vite.config.ts) sends `no-cache` in place of `immutable`.
- **See also:** [Safari honours `Clear-Site-Data: "cache"`](#safari-honours-clear-site-data-cache-and-chrome-ignored-it-on-127001), for a phone already stuck.

## Safari honours `Clear-Site-Data: "cache"`, and Chrome ignored it on `127.0.0.1`

An immutable script came from the cache on reload, and after a page answering with the header, WebKit fetched it again and Chromium didn't. Only clearing all browsing data got the iPhone off the duplicate React.

- **Measured:** Playwright's WebKit and Chromium; versions not recorded.
- **In seamux:** [app/routes/reset.ts](../app/routes/reset.ts), the `/reset` page, sends the header, and the error page links to it.
- **See also:** [Try it in Playwright's WebKit](measuring.md#try-it-in-playwrights-webkit).
