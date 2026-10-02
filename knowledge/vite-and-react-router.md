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

## Vite doesn't always move an import's `?t=` stamp

The dev server rewrites `import "./app.css"` in `root.tsx` to `/app/app.css?t=<last hot update>`. A landing at 15:52 changed `app.css` and the stamp stayed at 14:57, the landing before, so the same URL served a different stylesheet. A fresh start of the dev server drops the stamp altogether, back to a URL served before.

- **Measured:** Vite 8.3.0, React Router 7.18.4, `@tailwindcss/vite` 4.
- **In seamux:** `bustStylesheet` in [vite.config.ts](../vite.config.ts) adds `?boot=<server start>` to the import, in dev only; the compiled board's stylesheet is named by its hash.
- **See also:** [Cloudflare's edge kept a stylesheet the board had changed](cloudflare-tunnel.md#cloudflares-edge-kept-a-stylesheet-the-board-had-changed), and [Vite's file watcher missed a landing](#vites-file-watcher-missed-a-landing), which leaves every stamp where it was.

## Vite's file watcher missed a landing

After `npm run land` fast-forwarded main, the files on disk were new and the dev server kept serving the old ones: `dispatch-bar.tsx` without the landed change, its importers still stamped with the landing before, and a stylesheet without the Tailwind classes the change used. It stayed that way through reloads, on `localhost` as much as on a phone, until the board restarted. The landing before it, half an hour earlier on the same server, was picked up. A throwaway Vite project with its watcher off (`server.watch: null`) shows the cure: emitting `change` for a file on `server.watcher` updates it as an edit would, a new stamp on its importers and the stylesheet's, and a stylesheet regenerated with the file's classes.

- **Measured:** macOS 26.5.1, Vite 8.3.0, React Router 7.18.4, `@tailwindcss/vite` 4.3.3. Why the watcher missed it is not known.
- **In seamux:** [scripts/land.ts](../scripts/land.ts) records the files a landing changed in `data/board.landed` ([scripts/landed.ts](../scripts/landed.ts)); `replayLandings` in [vite.config.ts](../vite.config.ts) polls that file and emits a change for each.

## Vite serves any `v=` query as immutable

A module requested with a `v=` query goes out as `Cache-Control: max-age=31536000,immutable`, as the pre-bundled dependencies do: Vite's `DEP_VERSION_RE` matches `v=` anywhere in the query, whatever the module. `bustStylesheet`'s `?v=` put the stylesheet under it, so a browser was told to keep each start's stylesheet for a year. Any other name, such as `?boot=`, goes out as `no-cache`.

- **Measured:** Vite 8.3.0, `@tailwindcss/vite` 4.3.3.
- **In seamux:** `bustStylesheet` in [vite.config.ts](../vite.config.ts) uses `?boot=`.
- **See also:** [Vite serves its pre-bundled dependencies as immutable](#vite-serves-its-pre-bundled-dependencies-as-immutable).
