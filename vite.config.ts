import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

import { forgetDotenv } from "./app/lib/credentials.ts";
import { SEAMUX_HOME } from "./app/lib/paths.server.ts";
import {
  lanHost,
  lanWanted,
  LISTEN_ENV,
  remoteDomain,
  remoteGate,
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

// The remote-access gate, ahead of everything Vite answers itself.
function remoteAccess(): Plugin {
  return {
    name: "seamux-remote-access",
    configureServer(server) {
      server.middlewares.use(remoteGate(SEAMUX_HOME));
    },
  };
}

// Vite marks its pre-bundled dependencies immutable for a year. Safari on a
// phone keeps them, and after the board restarts and bundles them again, a
// reload runs its old copy of React beside the new chunks and fails on every
// render, never asking for the old files again. Asked to revalidate, the
// browser gets a 304 for each while nothing changed, and never a stale one.
function revalidateDeps(): Plugin {
  return {
    name: "seamux-revalidate-deps",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes("/node_modules/.vite/")) {
          const setHeader = res.setHeader.bind(res);
          res.setHeader = ((name: string, value: number | string | string[]) =>
            setHeader(
              name,
              name.toLowerCase() === "cache-control" ? "no-cache" : value,
            )) as typeof res.setHeader;
        }
        next();
      });
    },
  };
}

// Before React Router loads .env again, so a variable deleted from it goes.
forgetDotenv();

// The tunnel's hostname and whether mDNS is on, read once at startup:
// changing either needs the dev server restarted, which the supervisor does
// for mDNS.
const domain = remoteDomain(SEAMUX_HOME);
const lan = lanWanted(SEAMUX_HOME);
// The board's loaders run in this process, and tell the Remote tab.
process.env[LISTEN_ENV] = lan ? "lan" : "local";

export default defineConfig({
  plugins: [remoteAccess(), revalidateDeps(), tailwindcss(), reactRouter()],
  // Bound to localhost only, unless mDNS is on: this server spawns processes
  // and reads every transcript. The Cloudflare tunnel connects from this Mac.
  server: {
    host: lan ? true : "127.0.0.1",
    allowedHosts: [...(domain ? [domain] : []), ...(lan ? [lanHost()] : [])],
    port: 54321,
    strictPort: true,
    watch: needsPolling() ? { usePolling: true, interval: 500 } : undefined,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
