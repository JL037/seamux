import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

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

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  // Localhost only: this server spawns processes and reads every transcript.
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: needsPolling() ? { usePolling: true, interval: 500 } : undefined,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
