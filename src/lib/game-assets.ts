import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GAME_ASSET_KEYS,
  type GameAssetKey,
  type GameAssetPackName,
  type GameAssetUserConfig,
  type GameAssetsManifest
} from "./types.js";

const USER_ASSET_CONFIG_PATH = path.join(
  os.homedir(),
  ".claudecraft",
  "game-assets",
  "config.json"
);
const PLACEHOLDER_PACK_DIR = path.join(
  os.homedir(),
  ".claudecraft",
  "game-assets",
  "packs",
  "placeholder"
);

export interface ResolvedGameAssets {
  selectedPack: GameAssetPackName;
  sourceDir: string;
  files: Record<GameAssetKey, string>;
  fallbackReason?: string;
}

export interface GameAssetsDoctorReport {
  configPath: string;
  configExists: boolean;
  selectedPack: GameAssetPackName;
  sourceDir: string;
  fallbackReason?: string;
  missingFiles: string[];
}

export async function readGameAssetsManifest(packageRoot: string): Promise<GameAssetsManifest> {
  const manifestPath = path.join(packageRoot, "assets", "game-assets.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isGameAssetsManifest(parsed)) {
    throw new Error(`Invalid game asset manifest: ${manifestPath}`);
  }
  return parsed;
}

export async function resolveGameAssets(input: {
  packageRoot: string;
  verbose?: boolean;
}): Promise<ResolvedGameAssets> {
  const manifest = await readGameAssetsManifest(input.packageRoot);
  const userConfig = await readUserAssetConfig();
  const selectedPack = userConfig?.selectedPack ?? manifest.defaultPack;
  const openRtsDir = path.join(input.packageRoot, "assets", "open-rts-pack");

  if (selectedPack === "open-rts") {
    const missing = await missingPackFiles(openRtsDir, manifest.packs["open-rts"].files);
    if (missing.length === 0) {
      return {
        selectedPack: "open-rts",
        sourceDir: openRtsDir,
        files: resolveFileMap(openRtsDir, manifest.packs["open-rts"].files)
      };
    }
    return await fallbackToPlaceholder(
      manifest,
      `Open RTS pack missing files: ${missing.join(", ")}`
    );
  }

  if (selectedPack === "starcraft-local") {
    const customPackDir = userConfig?.customPackDir;
    if (customPackDir) {
      const missing = await missingPackFiles(
        path.resolve(customPackDir),
        manifest.packs["starcraft-local"].files
      );
      if (missing.length === 0) {
        return {
          selectedPack: "starcraft-local",
          sourceDir: path.resolve(customPackDir),
          files: resolveFileMap(path.resolve(customPackDir), manifest.packs["starcraft-local"].files)
        };
      }
      return await fallbackToPlaceholder(manifest, `Missing custom assets: ${missing.join(", ")}`);
    }
    return await fallbackToPlaceholder(manifest, "No custom starcraft-local asset directory configured");
  }

  if (input.verbose) {
    process.stdout.write("Using placeholder game assets.\n");
  }
  await ensurePlaceholderPackFiles(manifest.packs.placeholder.files);
  return {
    selectedPack: "placeholder",
    sourceDir: PLACEHOLDER_PACK_DIR,
    files: resolveFileMap(PLACEHOLDER_PACK_DIR, manifest.packs.placeholder.files)
  };
}

export async function installGameAssetsPack(input: {
  packageRoot: string;
  pack: GameAssetPackName;
  assetsDir?: string;
  verbose?: boolean;
}): Promise<{ selectedPack: GameAssetPackName; sourceDir: string; missing: string[] }> {
  const manifest = await readGameAssetsManifest(input.packageRoot);
  const openRtsDir = path.join(input.packageRoot, "assets", "open-rts-pack");

  if (input.pack === "open-rts") {
    const missing = await missingPackFiles(openRtsDir, manifest.packs["open-rts"].files);
    if (missing.length > 0) {
      throw new Error(`Bundled open-rts pack is missing files: ${missing.join(", ")}`);
    }
    await writeUserAssetConfig({
      selectedPack: "open-rts",
      installedAt: new Date().toISOString()
    });
    return {
      selectedPack: "open-rts",
      sourceDir: openRtsDir,
      missing: []
    };
  }

  if (input.pack === "placeholder") {
    await ensurePlaceholderPackFiles(manifest.packs.placeholder.files);
    await writeUserAssetConfig({
      selectedPack: "placeholder",
      installedAt: new Date().toISOString()
    });
    return {
      selectedPack: "placeholder",
      sourceDir: PLACEHOLDER_PACK_DIR,
      missing: []
    };
  }

  if (!input.assetsDir) {
    throw new Error("--assets-dir is required for starcraft-local pack");
  }

  const customDir = path.resolve(input.assetsDir);
  const missing = await missingPackFiles(customDir, manifest.packs["starcraft-local"].files);
  if (missing.length > 0) {
    throw new Error(`Provided asset pack is missing files: ${missing.join(", ")}`);
  }

  await writeUserAssetConfig({
    selectedPack: "starcraft-local",
    customPackDir: customDir,
    installedAt: new Date().toISOString()
  });

  if (input.verbose) {
    process.stdout.write(`Configured custom pack from ${customDir}\n`);
  }

  return {
    selectedPack: "starcraft-local",
    sourceDir: customDir,
    missing: []
  };
}

export async function doctorGameAssets(packageRoot: string): Promise<GameAssetsDoctorReport> {
  const manifest = await readGameAssetsManifest(packageRoot);
  const userConfig = await readUserAssetConfig();
  const configExists = await pathExists(USER_ASSET_CONFIG_PATH);

  const resolved = await resolveGameAssets({ packageRoot });

  const filesForSelectedPack =
    resolved.selectedPack === "starcraft-local"
      ? manifest.packs["starcraft-local"].files
      : resolved.selectedPack === "open-rts"
        ? manifest.packs["open-rts"].files
        : manifest.packs.placeholder.files;

  const missing = await missingPackFiles(resolved.sourceDir, filesForSelectedPack);

  return {
    configPath: USER_ASSET_CONFIG_PATH,
    configExists,
    selectedPack: resolved.selectedPack,
    sourceDir: resolved.sourceDir,
    fallbackReason: resolved.fallbackReason,
    missingFiles: missing
  };
}

async function fallbackToPlaceholder(
  manifest: GameAssetsManifest,
  fallbackReason: string
): Promise<ResolvedGameAssets> {
  await ensurePlaceholderPackFiles(manifest.packs.placeholder.files);
  return {
    selectedPack: "placeholder",
    sourceDir: PLACEHOLDER_PACK_DIR,
    files: resolveFileMap(PLACEHOLDER_PACK_DIR, manifest.packs.placeholder.files),
    fallbackReason
  };
}

function resolveFileMap(
  sourceDir: string,
  files: Record<GameAssetKey, string>
): Record<GameAssetKey, string> {
  return {
    worker: path.join(sourceDir, files.worker),
    base: path.join(sourceDir, files.base),
    mineralPatch: path.join(sourceDir, files.mineralPatch),
    unitLight: path.join(sourceDir, files.unitLight),
    unitHeavy: path.join(sourceDir, files.unitHeavy),
    queue: path.join(sourceDir, files.queue)
  };
}

async function ensurePlaceholderPackFiles(files: Record<GameAssetKey, string>): Promise<void> {
  for (const key of GAME_ASSET_KEYS) {
    const relative = files[key];
    const fullPath = path.join(PLACEHOLDER_PACK_DIR, relative);
    if (await pathExists(fullPath)) {
      continue;
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buildPlaceholderSvg(key), "utf8");
  }
}

function buildPlaceholderSvg(key: GameAssetKey): string {
  const labelMap: Record<GameAssetKey, string> = {
    worker: "Worker",
    base: "Base",
    mineralPatch: "Mineral",
    unitLight: "Unit-L",
    unitHeavy: "Unit-H",
    queue: "Queue"
  };

  const colorMap: Record<GameAssetKey, string> = {
    worker: "#6fbf73",
    base: "#5a67d8",
    mineralPatch: "#00a3c4",
    unitLight: "#f6ad55",
    unitHeavy: "#f56565",
    queue: "#b794f4"
  };

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    '<rect x="2" y="2" width="92" height="92" rx="12" fill="#111827" stroke="#374151"/>',
    `<circle cx="48" cy="40" r="20" fill="${colorMap[key]}" opacity="0.9"/>`,
    `<text x="48" y="76" fill="#e5e7eb" text-anchor="middle" font-size="12" font-family="monospace">${labelMap[key]}</text>`,
    "</svg>"
  ].join("");
}

async function readUserAssetConfig(): Promise<GameAssetUserConfig | undefined> {
  try {
    const raw = await fs.readFile(USER_ASSET_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isGameAssetUserConfig(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function writeUserAssetConfig(config: GameAssetUserConfig): Promise<void> {
  await fs.mkdir(path.dirname(USER_ASSET_CONFIG_PATH), { recursive: true });
  await fs.writeFile(USER_ASSET_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function missingPackFiles(
  root: string,
  files: Record<GameAssetKey, string>
): Promise<string[]> {
  const missing: string[] = [];
  for (const key of GAME_ASSET_KEYS) {
    const file = path.join(root, files[key]);
    if (!(await pathExists(file))) {
      missing.push(files[key]);
    }
  }
  return missing;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isGameAssetsManifest(value: unknown): value is GameAssetsManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const manifest = value as Partial<GameAssetsManifest>;
  if (manifest.version !== 1) {
    return false;
  }
  if (
    manifest.defaultPack !== "open-rts" &&
    manifest.defaultPack !== "placeholder" &&
    manifest.defaultPack !== "starcraft-local"
  ) {
    return false;
  }
  if (!manifest.packs || typeof manifest.packs !== "object" || Array.isArray(manifest.packs)) {
    return false;
  }

  return (
    isPackDefinition(manifest.packs["open-rts"]) &&
    isPackDefinition(manifest.packs.placeholder) &&
    isPackDefinition(manifest.packs["starcraft-local"])
  );
}

function isPackDefinition(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const pack = value as Partial<{ source: string; files: Record<string, string> }>;
  if (pack.source !== "bundled" && pack.source !== "generated" && pack.source !== "user") {
    return false;
  }
  if (!pack.files || typeof pack.files !== "object" || Array.isArray(pack.files)) {
    return false;
  }

  const files = pack.files as Record<string, string>;
  return GAME_ASSET_KEYS.every((key) => {
    const item = files[key];
    return typeof item === "string" && item.length > 0;
  });
}

function isGameAssetUserConfig(value: unknown): value is GameAssetUserConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const config = value as Partial<GameAssetUserConfig>;
  if (
    config.selectedPack !== "open-rts" &&
    config.selectedPack !== "placeholder" &&
    config.selectedPack !== "starcraft-local"
  ) {
    return false;
  }
  if (typeof config.installedAt !== "string" || config.installedAt.length === 0) {
    return false;
  }

  if (config.customPackDir !== undefined && typeof config.customPackDir !== "string") {
    return false;
  }

  return true;
}
