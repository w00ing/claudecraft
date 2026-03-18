import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  readManagedCodexHooksFeatureState,
  readManagedCodexHooksState,
  resolveCodexHooksPath,
  uninstallManagedCodexNotify,
  uninstallManagedCodexHooks,
  uninstallManagedCodexHooksFeature,
  upsertManagedCodexNotify,
  upsertManagedCodexHooks,
  upsertManagedCodexHooksFeature
} from "../src/lib/codex-config.js";

async function makeCodexConfigPath(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentcraft-codex-"));
  const codexDir = path.join(tmpDir, ".codex");
  await fs.mkdir(codexDir, { recursive: true });
  return path.join(codexDir, "config.toml");
}

describe("codex-config", () => {
  test("manages codex_hooks feature inside an existing features table", async () => {
    const configPath = await makeCodexConfigPath();
    await fs.writeFile(configPath, '[features]\njs_repl = true\n', "utf8");

    const result = await upsertManagedCodexHooksFeature(configPath);
    expect(result).toEqual({ added: true, updated: false });

    const content = await fs.readFile(configPath, "utf8");
    expect(content).toContain("[features]");
    expect(content).toContain("js_repl = true");
    expect(content).toContain("codex_hooks = true");

    const state = await readManagedCodexHooksFeatureState(configPath);
    expect(state.hasManagedFeature).toBe(true);
    expect(state.codexHooksEnabled).toBe(true);

    const removed = await uninstallManagedCodexHooksFeature(configPath);
    expect(removed.removed).toBe(true);

    const finalContent = await fs.readFile(configPath, "utf8");
    expect(finalContent).toContain("[features]");
    expect(finalContent).toContain("js_repl = true");
    expect(finalContent).not.toContain("codex_hooks = true");
  });

  test("keeps notify block separate from the managed codex_hooks feature block", async () => {
    const configPath = await makeCodexConfigPath();

    await upsertManagedCodexHooksFeature(configPath);
    await upsertManagedCodexNotify({
      configPath,
      command: ["node", "/tmp/play-sound.js", "--event", "Notification"]
    });

    const content = await fs.readFile(configPath, "utf8");
    expect(content.indexOf("# BEGIN agentcraft managed notify")).toBeLessThan(
      content.indexOf("# BEGIN agentcraft managed codex hooks")
    );
    expect(content).toContain("# END agentcraft managed notify\n# BEGIN agentcraft managed codex hooks");
  });

  test("merges managed hooks into hooks.json and preserves external entries", async () => {
    const configPath = await makeCodexConfigPath();
    const hooksPath = resolveCodexHooksPath(configPath);
    await fs.writeFile(
      hooksPath,
      `${JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                hooks: [{ type: "command", command: "echo external-start", timeout: 30 }]
              }
            ],
            Stop: [
              {
                hooks: [{ type: "command", command: "echo external-stop", timeout: 30 }]
              }
            ]
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await upsertManagedCodexHooks({
      configPath,
      hooks: [
        {
          event: "SessionStart",
          command: 'node "/tmp/play-sound.js" --event "SessionStart" --managed-by "agentcraft"'
        },
        {
          event: "Stop",
          command: 'node "/tmp/play-sound.js" --event "Stop" --managed-by "agentcraft"'
        }
      ]
    });

    expect(result).toEqual({ added: 2, updated: 0 });

    const parsed = JSON.parse(await fs.readFile(hooksPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(parsed.hooks.SessionStart).toHaveLength(2);
    expect(parsed.hooks.Stop).toHaveLength(2);

    const state = await readManagedCodexHooksState(configPath);
    expect(state.installedEvents).toEqual(["SessionStart", "Stop"]);

    const removed = await uninstallManagedCodexHooks(configPath);
    expect(removed.removed).toBe(2);
    expect(removed.deletedFile).toBe(false);

    const finalParsed = JSON.parse(await fs.readFile(hooksPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(finalParsed.hooks.SessionStart).toHaveLength(1);
    expect(finalParsed.hooks.SessionStart[0]?.hooks[0]?.command).toBe("echo external-start");
    expect(finalParsed.hooks.Stop).toHaveLength(1);
    expect(finalParsed.hooks.Stop[0]?.hooks[0]?.command).toBe("echo external-stop");
  });

  test("removes empty config.toml after uninstalling the last managed Codex entries", async () => {
    const configPath = await makeCodexConfigPath();

    await upsertManagedCodexNotify({
      configPath,
      command: ["node", "/tmp/play-sound.js", "--event", "Notification"]
    });
    await upsertManagedCodexHooksFeature(configPath);

    await uninstallManagedCodexNotify(configPath);
    await uninstallManagedCodexHooksFeature(configPath);

    await expect(fs.access(configPath)).rejects.toThrow();
  });
});
