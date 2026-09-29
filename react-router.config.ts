import type { Config } from "@react-router/dev/config";

import { SEAMUX_HOME } from "./app/lib/paths.server.ts";
import { remoteDomain } from "./app/lib/remote.server.ts";

// The tunnel's hostname, read once at startup, like Vite's allowedHosts. Not
// for a build, which would bake in the hostname of whoever built it: the
// compiled server (server/serve.ts) sets it from its own .env when it starts.
const domain = process.argv.includes("build")
  ? null
  : remoteDomain(SEAMUX_HOME);

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // Route middleware, for the HTTP Basic check in app/root.tsx, and split
  // route modules, v8's default (no route has client exports to split yet).
  future: { v8_middleware: true, v8_splitRouteModules: true },
  // cloudflared hands requests to the dev server over http, so an action
  // through the tunnel has an https Origin that doesn't match its request
  // URL, and React Router refuses it as cross-site. assertFromBoard still
  // requires the Origin to be exactly https://<domain>.
  allowedActionOrigins: domain ? [domain] : [],
} satisfies Config;
