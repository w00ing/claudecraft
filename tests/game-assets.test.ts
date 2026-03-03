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
    expect(manifest.defaultPack).toBe("placeholder");
    expect(manifest.packs.placeholder.files.worker).toBe("worker.svg");
  });

  test("resolves placeholder pack by default", async () => {
    const resolved = await resolveGameAssets({ packageRoot });
    expect(resolved.selectedPack).toBe("placeholder");
    expect(resolved.files.worker).toContain("worker");
    expect(resolved.sourceDir.length).toBeGreaterThan(0);
  });
});
