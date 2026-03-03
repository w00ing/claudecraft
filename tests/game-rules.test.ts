import { describe, expect, test } from "bun:test";
import { applyGameEvent, createInitialGameState } from "../src/lib/game-rules.js";

describe("game-rules", () => {
  test("creates deterministic initial state", () => {
    const state = createInitialGameState("terran");
    expect(state.minerals).toBe(50);
    expect(state.workers).toBe(4);
    expect(state.units.SCV).toBe(4);
  });

  test("pre-tool event queues a light unit when affordable", () => {
    const state = createInitialGameState("terran");
    const result = applyGameEvent({
      state,
      race: "terran",
      event: "PreToolUse",
      atIso: "2026-03-03T00:00:00.000Z"
    });

    expect(result.state.tick).toBe(1);
    expect(result.state.productionQueue.length).toBe(1);
    expect(result.state.productionQueue[0]?.unitType).toBe("Marine");
    expect(result.delta.note).toContain("Production request");
  });

  test("failure event applies mineral penalty and increments failure count", () => {
    const state = createInitialGameState("zerg");
    const result = applyGameEvent({
      state,
      race: "zerg",
      event: "PostToolUseFailure",
      atIso: "2026-03-03T00:00:00.000Z",
      payloadSummary: "{\"exit_code\":2}"
    });

    expect(result.state.stats.failures).toBe(1);
    expect(result.state.recentEvents.length).toBe(1);
    expect(result.state.recentEvents[0]?.payloadSummary).toContain("exit_code");
    expect(result.state.minerals).toBe(57);
    expect(result.delta.note).toContain("damaged");
  });
});
