#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { HookEventName } from "../lib/types.js";
import { readManifest, resolveSelection, resolveSoundPath } from "../lib/manifest.js";
import { applyHookEventToGameState, deriveGameStatePath } from "../lib/game-state.js";
import {
  isFailureInCooldown,
  isToolInCooldown,
  normalizeFailureCooldown,
  normalizeToolCooldown,
  shouldSuppressFailureByFilter
} from "../lib/failure-logic.js";
import {
  isRaceOption,
  pickPoolFile,
  resolveRaceForEvent,
  type PlayerState
} from "../lib/player-logic.js";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      flags[key] = value;
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function loadState(stateFilePath: string): Promise<PlayerState> {
  try {
    const raw = await fs.readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as PlayerState;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {};
    }
    return {};
  }
}

async function saveState(stateFilePath: string, state: PlayerState): Promise<void> {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  await fs.writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function playFile(soundPath: string): Promise<void> {
  if (process.platform === "darwin") {
    await run("afplay", [soundPath]);
    return;
  }

  if (process.platform === "linux") {
    try {
      await run("aplay", [soundPath]);
    } catch {
      await run("paplay", [soundPath]);
    }
    return;
  }

  if (process.platform === "win32") {
    const escapedPath = soundPath.replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Media;",
      `$player = New-Object System.Media.SoundPlayer('${escapedPath}');`,
      "$player.PlaySync();"
    ].join(" ");
    await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const event = flags.event as HookEventName | undefined;
  const manifestPath = flags.manifest;
  const stateFilePath = flags["state-file"];
  const soundsDir = flags["sounds-dir"];
  const raceFlag = flags.race;
  const toolCooldownSec = normalizeToolCooldown(parseInteger(flags["tool-cooldown"]));
  const failureCooldownSec = normalizeFailureCooldown(parseInteger(flags["failure-cooldown"]));
  const failureFilter = flags["no-failure-filter"] !== "true";

  if (!event || !manifestPath || !isRaceOption(raceFlag)) {
    process.exitCode = 1;
    return;
  }

  const state = stateFilePath ? await loadState(stateFilePath) : {};
  const raceResult = resolveRaceForEvent({
    requestedRace: raceFlag,
    event,
    state
  });
  const resolvedRace = raceResult.race;
  let stateChanged = raceResult.stateChanged;
  let shouldPlaySound = true;
  let payloadForGame: unknown = undefined;

  if (event === "PreToolUse" || event === "PostToolUse") {
    const nowMs = Date.now();
    if (
      isToolInCooldown({
        lastToolSoundAt: state.lastToolSoundAt,
        nowMs,
        cooldownSec: toolCooldownSec
      })
    ) {
      shouldPlaySound = false;
    } else {
      state.lastToolSoundAt = nowMs;
      stateChanged = true;
    }
  }

  if (event === "PostToolUseFailure") {
    const payload = await readStdinPayload();
    payloadForGame = payload;
    if (failureFilter && shouldSuppressFailureByFilter(payload)) {
      shouldPlaySound = false;
    } else {
      const nowMs = Date.now();
      if (
        isFailureInCooldown({
          lastFailureAt: state.lastFailureAt,
          nowMs,
          cooldownSec: failureCooldownSec
        })
      ) {
        shouldPlaySound = false;
      } else {
        state.lastFailureAt = nowMs;
        stateChanged = true;
      }
    }
  }

  try {
    const gameStatePath = deriveGameStatePath({
      configPath: stateFilePath ?? manifestPath,
      stateFilePath
    });
    await applyHookEventToGameState({
      gameStatePath,
      race: resolvedRace,
      event,
      payload: payloadForGame
    });
  } catch {
    // Game updates are best-effort and must not break hook playback.
  }

  if (stateFilePath && stateChanged) {
    await saveState(stateFilePath, state);
  }

  if (!shouldPlaySound) {
    process.exitCode = 0;
    return;
  }

  const manifest = await readManifest(manifestPath);
  const selection = resolveSelection(manifest, resolvedRace, event);
  let fileName: string;
  if (selection.type === "single") {
    fileName = selection.file;
  } else {
    const key = `${resolvedRace}:${event}`;
    const lastPlayed = state.lastPoolByKey?.[key];
    fileName = pickPoolFile(selection.files, lastPlayed);
    state.lastPoolByKey = state.lastPoolByKey ?? {};
    state.lastPoolByKey[key] = fileName;
    if (stateFilePath) {
      await saveState(stateFilePath, state);
    }
  }

  const soundPath = resolveSoundPath(manifestPath, manifest, fileName, soundsDir);
  await playFile(soundPath);
}

main().catch(() => {
  process.exitCode = 1;
});

async function readStdinPayload(): Promise<unknown> {
  if (process.stdin.isTTY) {
    return undefined;
  }
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
