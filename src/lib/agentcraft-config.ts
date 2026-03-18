import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentProvider,
  AgentcraftMetadata,
  HookPreset,
  InstallScope
} from "./types.js";

const METADATA_VERSION = 1;

export function resolveMetadataPath(input: {
  agent: AgentProvider;
  configPath: string;
}): string {
  return path.join(path.dirname(path.resolve(input.configPath)), `agentcraft-${input.agent}.json`);
}

export function resolveDefaultStateFilePath(input: {
  agent: AgentProvider;
  configPath: string;
}): string {
  return path.join(
    path.dirname(path.resolve(input.configPath)),
    `agentcraft-${input.agent}-session.json`
  );
}

export function resolveGameStateFilePathFromStateFile(stateFilePath: string): string {
  const resolved = path.resolve(stateFilePath);
  const baseName = path.basename(resolved);
  if (baseName.endsWith("-session.json")) {
    return path.join(
      path.dirname(resolved),
      `${baseName.slice(0, -"-session.json".length)}-game-state.json`
    );
  }
  return path.join(path.dirname(resolved), "agentcraft-game-state.json");
}

export async function readAgentcraftMetadata(metadataPath: string): Promise<AgentcraftMetadata | undefined> {
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isAgentcraftMetadata(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeAgentcraftMetadata(
  metadataPath: string,
  metadata: AgentcraftMetadata
): Promise<void> {
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export async function deleteAgentcraftMetadata(metadataPath: string): Promise<boolean> {
  try {
    await fs.unlink(metadataPath);
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function buildAgentcraftMetadata(input: {
  agent: AgentProvider;
  configPath: string;
  race: AgentcraftMetadata["race"];
  soundsDir: string;
  toolCooldownSec: number;
  failureCooldownSec: number;
  failureFilter: boolean;
  stateFile?: string;
  installedAt?: string;
  preset?: HookPreset;
}): AgentcraftMetadata {
  return {
    version: METADATA_VERSION,
    agent: input.agent,
    race: input.race,
    source: "curated-sounds",
    manifestVersion: 2,
    stateFile:
      input.stateFile ??
      resolveDefaultStateFilePath({ agent: input.agent, configPath: input.configPath }),
    soundsDir: input.soundsDir,
    toolCooldownSec: input.toolCooldownSec,
    failureCooldownSec: input.failureCooldownSec,
    failureFilter: input.failureFilter,
    installedAt: input.installedAt ?? new Date().toISOString(),
    configPath: input.configPath,
    preset: input.preset
  };
}

export function formatScopeLabel(input: {
  agent: AgentProvider;
  scope: InstallScope;
}): string {
  if (input.agent === "claude") {
    return input.scope === "project"
      ? "Project local (.claude/settings.local.json)"
      : "Global (~/.claude/settings.json)";
  }

  return input.scope === "project"
    ? "Project local (.codex/config.toml)"
    : "Global (~/.codex/config.toml)";
}

function isAgentcraftMetadata(value: unknown): value is AgentcraftMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const metadata = value as Partial<AgentcraftMetadata>;
  return (
    metadata.version === METADATA_VERSION &&
    (metadata.agent === "claude" || metadata.agent === "codex") &&
    (metadata.race === "protoss" ||
      metadata.race === "terran" ||
      metadata.race === "zerg" ||
      metadata.race === "random") &&
    typeof metadata.source === "string" &&
    typeof metadata.manifestVersion === "number" &&
    typeof metadata.stateFile === "string" &&
    typeof metadata.soundsDir === "string" &&
    typeof metadata.toolCooldownSec === "number" &&
    typeof metadata.failureCooldownSec === "number" &&
    typeof metadata.failureFilter === "boolean" &&
    typeof metadata.installedAt === "string" &&
    typeof metadata.configPath === "string"
  );
}
