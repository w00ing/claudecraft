import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, "game-ui"),
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  build: {
    outDir: path.join(rootDir, "dist", "game-ui"),
    emptyOutDir: true
  }
});
