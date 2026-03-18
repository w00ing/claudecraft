import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGameAssetsManifest, resolveGameAssets } from "../src/lib/game-assets.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, "..");

describe("game-assets", () => {
  test("reads game asset manifest", async () => {
    const manifest = await readGameAssetsManifest(packageRoot);
    expect(manifest.version).toBe(1);
    expect(manifest.defaultPack).toBe("kenney-rts");
    expect(manifest.packs["kenney-rts"].files.worker).toBe("worker.png");
    expect(manifest.packs["kenney-rts"].files.commandMove).toBe("command-move.png");
  });

  test("resolves bundled kenney-rts pack by default", async () => {
    const resolved = await resolveGameAssets({ packageRoot, ignoreUserConfig: true });
    expect(resolved.selectedPack).toBe("kenney-rts");
    expect(resolved.files.worker).toContain("worker");
    expect(resolved.sourceDir.length).toBeGreaterThan(0);
  });

  test("resolves requested pack override for watch runtime", async () => {
    const resolved = await resolveGameAssets({
      packageRoot,
      preferredPack: "open-rts",
      ignoreUserConfig: true
    });
    expect(resolved.selectedPack).toBe("open-rts");
    expect(resolved.files.worker).toContain("worker");
  });
});
