import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  applyHookEventToGameState,
  deriveGameStatePath,
  loadGameState,
  resetGameState
} from "../src/lib/game-state.js";

describe("game-state", () => {
  test("derives game state path beside state-file", () => {
    const derived = deriveGameStatePath({
      configPath: "/tmp/settings.json",
      stateFilePath: "/tmp/claudecraft-session.json"
    });
    expect(derived).toBe("/tmp/claudecraft-game-state.json");
  });

  test("applies hook event and persists state", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claudecraft-game-"));
    const gameStatePath = path.join(tmpDir, "claudecraft-game-state.json");

    await applyHookEventToGameState({
      gameStatePath,
      race: "protoss",
      event: "SessionStart"
    });
    await applyHookEventToGameState({
      gameStatePath,
      race: "protoss",
      event: "UserPromptSubmit",
      payload: { tool: "Write" }
    });

    const loaded = await loadGameState(gameStatePath);
    expect(loaded).toBeDefined();
    expect(loaded?.race).toBe("protoss");
    expect(loaded?.stats.eventsHandled).toBe(2);
    expect(loaded?.recentEvents.length).toBe(2);

    const removed = await resetGameState(gameStatePath);
    expect(removed).toBe(true);
  });

  test("ignores non-fixed race", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claudecraft-game-"));
    const gameStatePath = path.join(tmpDir, "claudecraft-game-state.json");

    const result = await applyHookEventToGameState({
      gameStatePath,
      race: "random",
      event: "SessionStart"
    });

    expect(result).toBeUndefined();
    expect(await loadGameState(gameStatePath)).toBeUndefined();
  });
});
