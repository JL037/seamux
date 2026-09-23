import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  // Localhost only: this server spawns processes and reads every transcript.
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  resolve: {
    tsconfigPaths: true,
  },
});
