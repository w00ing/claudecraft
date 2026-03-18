import { describe, expect, test } from "bun:test";
import {
  buildClaudeHookCommand,
  buildCodexHookCommand,
  buildCodexNotifyCommand
} from "../src/lib/playback-command.js";

describe("playback-command", () => {
  test("includes failure cooldown and managed marker", () => {
    const command = buildClaudeHookCommand({
      playerScriptPath: "/tmp/play-sound.js",
      agent: "claude",
      manifestPath: "/tmp/manifest.json",
      event: "PostToolUseFailure",
      race: "zerg",
      stateFilePath: "/tmp/state.json",
      soundsDir: "/tmp/sounds",
      toolCooldownSec: 2,
      failureCooldownSec: 15,
      failureFilter: true
    });
    expect(command).toContain("--tool-cooldown \"2\"");
    expect(command).toContain("--failure-cooldown \"15\"");
    expect(command).toContain("--managed-by \"agentcraft\"");
    expect(command).not.toContain("--no-failure-filter");
  });

  test("adds no-failure-filter flag when disabled", () => {
    const command = buildClaudeHookCommand({
      playerScriptPath: "/tmp/play-sound.js",
      agent: "claude",
      manifestPath: "/tmp/manifest.json",
      event: "PostToolUseFailure",
      race: "terran",
      stateFilePath: "/tmp/state.json",
      soundsDir: "/tmp/sounds",
      toolCooldownSec: 1,
      failureCooldownSec: 7,
      failureFilter: false
    });
    expect(command).toContain("--no-failure-filter");
  });

  test("builds Codex native hook commands as shell strings", () => {
    const command = buildCodexHookCommand({
      playerScriptPath: "/tmp/play-sound.js",
      agent: "codex",
      manifestPath: "/tmp/manifest.json",
      event: "SessionStart",
      race: "protoss",
      stateFilePath: "/tmp/state.json",
      soundsDir: "/tmp/sounds",
      toolCooldownSec: 2,
      failureCooldownSec: 15,
      failureFilter: true
    });

    expect(command).toContain("--agent \"codex\"");
    expect(command).toContain("--event \"SessionStart\"");
    expect(command).toContain("--managed-by \"agentcraft\"");
  });

  test("builds Codex notify commands as argv arrays", () => {
    const command = buildCodexNotifyCommand({
      playerScriptPath: "/tmp/play-sound.js",
      agent: "codex",
      notifyEvent: "agent-turn-complete",
      manifestPath: "/tmp/manifest.json",
      event: "Notification",
      race: "random",
      stateFilePath: "/tmp/state.json",
      soundsDir: "/tmp/sounds",
      toolCooldownSec: 2,
      failureCooldownSec: 15,
      failureFilter: false
    });

    expect(command).toContain("agent-turn-complete");
    expect(command).toContain("Notification");
    expect(command).toContain("--no-failure-filter");
  });
});
