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
  ".agentcraft",
  "game-assets",
  "config.json"
);
const PLACEHOLDER_PACK_DIR = path.join(
  os.homedir(),
  ".agentcraft",
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
  preferredPack?: GameAssetPackName;
  ignoreUserConfig?: boolean;
}): Promise<ResolvedGameAssets> {
  const manifest = await readGameAssetsManifest(input.packageRoot);
  const userConfig = input.ignoreUserConfig ? undefined : await readUserAssetConfig();
  const selectedPack = input.preferredPack ?? userConfig?.selectedPack ?? manifest.defaultPack;

  if (selectedPack === "kenney-rts" || selectedPack === "open-rts") {
    return await resolveBundledPack(manifest, input.packageRoot, selectedPack);
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

  if (input.pack === "kenney-rts" || input.pack === "open-rts") {
    const bundledDir = path.join(input.packageRoot, "assets", `${input.pack}-pack`);
    const missing = await missingPackFiles(bundledDir, manifest.packs[input.pack].files);
    if (missing.length > 0) {
      throw new Error(`Bundled ${input.pack} pack is missing files: ${missing.join(", ")}`);
    }
    await writeUserAssetConfig({
      selectedPack: input.pack,
      installedAt: new Date().toISOString()
    });
    return {
      selectedPack: input.pack,
      sourceDir: bundledDir,
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
  const configExists = await pathExists(USER_ASSET_CONFIG_PATH);

  const resolved = await resolveGameAssets({ packageRoot });
  const filesForSelectedPack = manifest.packs[resolved.selectedPack].files;

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

async function resolveBundledPack(
  manifest: GameAssetsManifest,
  packageRoot: string,
  selectedPack: "kenney-rts" | "open-rts"
): Promise<ResolvedGameAssets> {
  const sourceDir = path.join(packageRoot, "assets", `${selectedPack}-pack`);
  const missing = await missingPackFiles(sourceDir, manifest.packs[selectedPack].files);
  if (missing.length === 0) {
    return {
      selectedPack,
      sourceDir,
      files: resolveFileMap(sourceDir, manifest.packs[selectedPack].files)
    };
  }
  return await fallbackToPlaceholder(
    manifest,
    `${selectedPack} pack missing files: ${missing.join(", ")}`
  );
}

function resolveFileMap(
  sourceDir: string,
  files: Record<GameAssetKey, string>
): Record<GameAssetKey, string> {
  const resolved = {} as Record<GameAssetKey, string>;
  for (const key of GAME_ASSET_KEYS) {
    resolved[key] = path.join(sourceDir, files[key]);
  }
  return resolved;
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
  const labelMap: Partial<Record<GameAssetKey, string>> = {
    worker: "Worker",
    base: "Base",
    mineralPatch: "Mineral",
    unitLight: "Unit-L",
    unitHeavy: "Unit-H",
    queue: "Queue",
    terrainTile: "Terrain",
    terrainCreep: "Creep",
    uiTopTerran: "UI-T-Top",
    uiBottomTerran: "UI-T-Bot",
    uiTopProtoss: "UI-P-Top",
    uiBottomProtoss: "UI-P-Bot",
    uiTopZerg: "UI-Z-Top",
    uiBottomZerg: "UI-Z-Bot",
    minimapFrame: "Minimap",
    iconMinerals: "Minerals",
    iconSupply: "Supply",
    portraitWorkerTerran: "SCV",
    portraitWorkerProtoss: "Probe",
    portraitWorkerZerg: "Drone",
    commandMove: "Move",
    commandStop: "Stop",
    commandHold: "Hold"
  };

  const colorMap: Partial<Record<GameAssetKey, string>> = {
    worker: "#6fbf73",
    base: "#5a67d8",
    mineralPatch: "#00a3c4",
    unitLight: "#f6ad55",
    unitHeavy: "#f56565",
    queue: "#b794f4",
    terrainTile: "#64748b",
    terrainCreep: "#a855f7",
    uiTopTerran: "#1e3a8a",
    uiBottomTerran: "#1d4ed8",
    uiTopProtoss: "#d97706",
    uiBottomProtoss: "#f59e0b",
    uiTopZerg: "#7e22ce",
    uiBottomZerg: "#6b21a8",
    minimapFrame: "#0ea5e9",
    iconMinerals: "#22d3ee",
    iconSupply: "#22c55e",
    portraitWorkerTerran: "#0284c7",
    portraitWorkerProtoss: "#facc15",
    portraitWorkerZerg: "#fb7185",
    commandMove: "#10b981",
    commandStop: "#ef4444",
    commandHold: "#f59e0b"
  };

  const label = labelMap[key] ?? key;
  const color = colorMap[key] ?? "#64748b";

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    '<rect x="2" y="2" width="92" height="92" rx="12" fill="#111827" stroke="#374151"/>',
    `<circle cx="48" cy="40" r="20" fill="${color}" opacity="0.9"/>`,
    `<text x="48" y="76" fill="#e5e7eb" text-anchor="middle" font-size="12" font-family="monospace">${label}</text>`,
    "</svg>"
  ].join("");
}

async function readUserAssetConfig(): Promise<GameAssetUserConfig | undefined> {
  try {
    const raw = await fs.readFile(USER_ASSET_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isGameAssetUserConfig(parsed) ? parsed : undefined;
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
    manifest.defaultPack !== "kenney-rts" &&
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
    isPackDefinition(manifest.packs["kenney-rts"]) &&
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
    config.selectedPack !== "kenney-rts" &&
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
