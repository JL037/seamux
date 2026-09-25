import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

import {
  ACCESS_HEADER,
  checkTunnelRequest,
  forbiddenPage,
  remoteDomain,
} from "./app/lib/remote.server.ts";

// WSL does not deliver file events for Windows drives under /mnt/, so hot
// reload has to poll there. SEAMUX_POLL=1 forces it anywhere.
function needsPolling(): boolean {
  if (process.env.SEAMUX_POLL === "1") return true;
  if (process.platform !== "linux" || !process.cwd().startsWith("/mnt/")) {
    return false;
  }
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

// Through the tunnel, every request needs a valid Cloudflare Access token,
// including the ones Vite answers itself (modules, assets, files under the
// checkout) before the board's own auth middleware sees them.
function tunnelAccess(): Plugin {
  return {
    name: "seamux-tunnel-access",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const token = req.headers[ACCESS_HEADER];
        checkTunnelRequest(
          process.cwd(),
          req.headers.host ?? null,
          typeof token === "string" ? token : null,
        ).then((tunnel) => {
          if (tunnel.verdict !== "denied") return next();
          res.statusCode = 403;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(forbiddenPage(tunnel.reason));
        }, next);
      });
    },
  };
}

// The tunnel's hostname, read once at startup: changing SEAMUX_CF_DOMAIN
// needs the dev server restarted.
const domain = remoteDomain(process.cwd());

export default defineConfig({
  plugins: [tunnelAccess(), tailwindcss(), reactRouter()],
  // Bound to localhost only: this server spawns processes and reads every
  // transcript. The one other way in is the Cloudflare tunnel, which
  // connects from this Mac.
  server: {
    host: "127.0.0.1",
    allowedHosts: domain ? [domain] : [],
    port: 54321,
    strictPort: true,
    watch: needsPolling() ? { usePolling: true, interval: 500 } : undefined,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
