import { describe, expect, test } from "bun:test";
import {
  buildGameStateEnvelope,
  computeSessionActivity,
  normalizeIdleThreshold
} from "../src/commands/game.js";
import { createInitialGameState } from "../src/lib/game-rules.js";

describe("game-command helpers", () => {
  test("normalizes idle threshold to sane defaults", () => {
    expect(normalizeIdleThreshold(undefined)).toBe(20);
    expect(normalizeIdleThreshold(0)).toBe(1);
    expect(normalizeIdleThreshold(12.9)).toBe(12);
  });

  test("reports live session when last event is recent", () => {
    const state = createInitialGameState("terran");
    state.stats.lastEventAt = "2026-03-03T12:00:10.000Z";

    const result = computeSessionActivity(state, 20, Date.parse("2026-03-03T12:00:20.000Z"));
    expect(result.sessionStatus).toBe("live");
    expect(result.idleSeconds).toBe(10);
  });

  test("reports idle session when threshold exceeded", () => {
    const state = createInitialGameState("protoss");
    state.stats.lastEventAt = "2026-03-03T12:00:10.000Z";

    const result = computeSessionActivity(state, 20, Date.parse("2026-03-03T12:00:45.000Z"));
    expect(result.sessionStatus).toBe("idle");
    expect(result.idleSeconds).toBe(35);
  });

  test("builds envelope with bound state path", () => {
    const state = createInitialGameState("zerg");
    state.stats.lastEventAt = "2026-03-03T12:00:10.000Z";

    const envelope = buildGameStateEnvelope(
      state,
      "/tmp/agentcraft-game-state.json",
      20,
      Date.parse("2026-03-03T12:00:12.000Z")
    );

    expect(envelope.boundGameStatePath).toBe("/tmp/agentcraft-game-state.json");
    expect(envelope.sessionStatus).toBe("live");
    expect(envelope.state.race).toBe("zerg");
  });
});
