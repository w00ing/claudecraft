import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listAllManifestFiles, readManifest } from "./manifest.js";
import { readSoundSourceConfig } from "./sound-source.js";

export interface EnsureSoundsResult {
  soundsDir: string;
  downloaded: number;
}

export async function ensureSoundsAvailable(input: {
  packageRoot: string;
  manifestPath: string;
  explicitSoundsDir?: string;
  verbose?: boolean;
}): Promise<EnsureSoundsResult> {
  const manifest = await readManifest(input.manifestPath);
  const files = listAllManifestFiles(manifest);

  if (input.explicitSoundsDir) {
    const explicitDir = path.resolve(input.explicitSoundsDir);
    const missing = await missingFiles(explicitDir, files);
    if (missing.length > 0) {
      throw new Error(
        `Provided --sounds-dir is missing files: ${missing.slice(0, 5).join(", ")}${
          missing.length > 5 ? "..." : ""
        }`
      );
    }
    return { soundsDir: explicitDir, downloaded: 0 };
  }

  const bundledDir = path.join(input.packageRoot, "curated-sounds");
  const bundledMissing = await missingFiles(bundledDir, files);
  if (bundledMissing.length === 0) {
    return { soundsDir: bundledDir, downloaded: 0 };
  }

  const cacheDir = path.join(os.homedir(), ".agentcraft", "sounds", "curated-sounds");
  const missing = await missingFiles(cacheDir, files);
  if (missing.length === 0) {
    return { soundsDir: cacheDir, downloaded: 0 };
  }

  const sourceConfigPath = path.join(input.packageRoot, "assets", "sound-source.json");
  const source = await readSoundSourceConfig(sourceConfigPath);
  let downloaded = 0;

  for (const file of missing) {
    const url = githubRawUrl(source.owner, source.repo, source.ref, source.subdir, file);
    if (input.verbose) {
      process.stdout.write(`Downloading ${file}...\n`);
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${file} (${response.status}): ${url}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const outputPath = path.join(cacheDir, file);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes);
    downloaded += 1;
  }

  return { soundsDir: cacheDir, downloaded };
}

async function missingFiles(soundsDir: string, files: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const file of files) {
    const fullPath = path.join(soundsDir, file);
    try {
      await fs.access(fullPath);
    } catch {
      missing.push(file);
    }
  }
  return missing;
}

function githubRawUrl(
  owner: string,
  repo: string,
  ref: string,
  subdir: string,
  file: string
): string {
  const parts = [
    owner,
    repo,
    ref,
    ...subdir.split("/").filter(Boolean),
    ...file.split("/").filter(Boolean)
  ].map(encodeURIComponent);
  return `https://raw.githubusercontent.com/${parts.join("/")}`;
}
