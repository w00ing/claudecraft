import fs from "node:fs/promises";
import path from "node:path";
import { resolveGameStateFilePathFromStateFile } from "./agentcraft-config.js";
import {
  applyGameEvent,
  createInitialGameState,
  summarizePayload
} from "./game-rules.js";
import { isFixedRace, type PlayerState } from "./player-logic.js";
import type { FixedRace, GameState, HookEventName } from "./types.js";

export const GAME_STATE_FILE_NAME = "agentcraft-game-state.json";

export function deriveGameStatePath(input: {
  configPath: string;
  stateFilePath?: string;
}): string {
  if (input.stateFilePath) {
    return resolveGameStateFilePathFromStateFile(input.stateFilePath);
  }
  return path.join(path.dirname(path.resolve(input.configPath)), GAME_STATE_FILE_NAME);
}

export async function loadGameState(gameStatePath: string): Promise<GameState | undefined> {
  try {
    const raw = await fs.readFile(gameStatePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isGameState(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

export async function saveGameState(gameStatePath: string, state: GameState): Promise<void> {
  await fs.mkdir(path.dirname(gameStatePath), { recursive: true });
  await fs.writeFile(gameStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function resetGameState(gameStatePath: string): Promise<boolean> {
  try {
    await fs.unlink(gameStatePath);
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function applyHookEventToGameState(input: {
  gameStatePath: string;
  race: string;
  event: HookEventName;
  payload?: unknown;
  now?: Date;
}): Promise<GameState | undefined> {
  if (!isFixedRace(input.race)) {
    return undefined;
  }

  const existing = await loadGameState(input.gameStatePath);
  const state = existing ?? createInitialGameState(input.race as FixedRace);

  const now = input.now ?? new Date();
  const result = applyGameEvent({
    state,
    race: input.race as FixedRace,
    event: input.event,
    atIso: now.toISOString(),
    payloadSummary: summarizePayload(input.payload)
  });

  await saveGameState(input.gameStatePath, result.state);
  return result.state;
}

export function detectRaceFromPlayerState(state: PlayerState): FixedRace | undefined {
  if (!state.selectedRace) {
    return undefined;
  }
  return isFixedRace(state.selectedRace) ? state.selectedRace : undefined;
}

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const state = value as Partial<GameState>;
  if (state.version !== 1) {
    return false;
  }
  if (state.race !== "protoss" && state.race !== "terran" && state.race !== "zerg") {
    return false;
  }
  if (typeof state.tick !== "number") {
    return false;
  }
  if (typeof state.minerals !== "number" || typeof state.gas !== "number") {
    return false;
  }
  if (typeof state.workers !== "number" || typeof state.workersMining !== "number") {
    return false;
  }
  if (!state.units || typeof state.units !== "object" || Array.isArray(state.units)) {
    return false;
  }
  if (!Array.isArray(state.productionQueue)) {
    return false;
  }
  if (!state.stats || typeof state.stats !== "object" || Array.isArray(state.stats)) {
    return false;
  }
  if (!Array.isArray(state.recentEvents)) {
    return false;
  }

  return true;
}
