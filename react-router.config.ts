import type { Config } from "@react-router/dev/config";

import { remoteDomain } from "./app/lib/remote.server.ts";

// The tunnel's hostname, read once at startup, like Vite's allowedHosts.
const domain = remoteDomain(process.cwd());

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // Route middleware, for the HTTP Basic check in app/root.tsx.
  future: { v8_middleware: true },
  // cloudflared hands requests to the dev server over http, so an action
  // through the tunnel has an https Origin that doesn't match its request
  // URL, and React Router refuses it as cross-site. assertFromBoard still
  // requires the Origin to be exactly https://<domain>.
  allowedActionOrigins: domain ? [domain] : [],
} satisfies Config;
