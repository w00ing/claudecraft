import { describe, expect, test } from "bun:test";
import {
  installManagedHook,
  listInstalledManagedEvents,
  uninstallManagedHooks
} from "../src/lib/hooks-merge.js";
import type { ClaudeSettings } from "../src/lib/types.js";

describe("hooks-merge", () => {
  test("install is idempotent and updates command when changed", () => {
    const settings: ClaudeSettings = {};
    const initial = installManagedHook(
      settings,
      "SessionStart",
      "node player.js --event \"SessionStart\" --managed-by \"agentcraft\""
    );
    expect(initial.added).toBe(true);
    expect(initial.updated).toBe(false);

    const duplicate = installManagedHook(
      settings,
      "SessionStart",
      "node player.js --event \"SessionStart\" --managed-by \"agentcraft\""
    );
    expect(duplicate.added).toBe(false);
    expect(duplicate.updated).toBe(false);

    const changed = installManagedHook(
      settings,
      "SessionStart",
      "node player.js --event \"SessionStart\" --race \"zerg\" --managed-by \"agentcraft\""
    );
    expect(changed.added).toBe(false);
    expect(changed.updated).toBe(true);

    const command = settings.hooks?.SessionStart?.[0]?.hooks?.[0]?.command;
    expect(command).toContain("--race \"zerg\"");
  });

  test("list and uninstall only managed hooks", () => {
    const settings: ClaudeSettings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "node managed.js --event \"SessionStart\" --managed-by \"agentcraft\""
              }
            ]
          }
        ],
        Stop: [
          {
            hooks: [{ type: "command", command: "echo external-hook" }]
          }
        ]
      }
    };

    expect(listInstalledManagedEvents(settings)).toEqual(["SessionStart"]);
    const removed = uninstallManagedHooks(settings);
    expect(removed.removed).toBe(1);
    expect(settings.hooks?.Stop?.length).toBe(1);
    expect(settings.hooks?.SessionStart).toBeUndefined();
  });

  test("applies tool matcher for PreToolUse hooks", () => {
    const settings: ClaudeSettings = {};
    const result = installManagedHook(
      settings,
      "PreToolUse",
      "node player.js --event \"PreToolUse\" --managed-by \"agentcraft\""
    );

    expect(result.added).toBe(true);
    expect(settings.hooks?.PreToolUse?.[0]?.matcher).toBe("Edit|Write|MultiEdit|Bash|Explore");
  });
});
