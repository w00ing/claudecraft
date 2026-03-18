import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const gameApiOrigin =
  process.env.AGENTCRAFT_GAME_API_ORIGIN ??
  process.env.CLAUDECRAFT_GAME_API_ORIGIN ??
  "http://127.0.0.1:4318";

export default defineConfig({
  root: path.join(rootDir, "game-ui"),
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: gameApiOrigin,
        changeOrigin: true
      },
      "/game-assets": {
        target: gameApiOrigin,
        changeOrigin: true
      },
      "/runtime-config.json": {
        target: gameApiOrigin,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: path.join(rootDir, "dist", "game-ui"),
    emptyOutDir: true
  }
});
