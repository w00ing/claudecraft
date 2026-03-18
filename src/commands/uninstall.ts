import fs from "node:fs/promises";
import {
  deleteAgentcraftMetadata,
  formatScopeLabel,
  readAgentcraftMetadata,
  resolveMetadataPath
} from "../lib/agentcraft-config.js";
import { resolveAgentProvider, resolveProviderConfigPath } from "../lib/agent-provider.js";
import { pathExists, readSettings, writeSettings } from "../lib/claude-config.js";
import {
  uninstallManagedCodexHooks,
  uninstallManagedCodexHooksFeature,
  uninstallManagedCodexNotify
} from "../lib/codex-config.js";
import { uninstallManagedHooks } from "../lib/hooks-merge.js";
import { confirmPrompt, selectPrompt } from "../lib/prompt.js";
import { showOutro, withSpinner } from "../lib/ui.js";
import type { InstallScope, UninstallOptions } from "../lib/types.js";

export async function runUninstall(options: UninstallOptions): Promise<void> {
  const agent = await resolveAgentProvider(options.agent);
  const scope =
    options.scope ??
    (await selectPrompt<InstallScope>("Uninstall scope:", [
      { label: formatScopeLabel({ agent, scope: "project" }), value: "project" },
      { label: formatScopeLabel({ agent, scope: "global" }), value: "global" }
    ]));

  const configPath = resolveProviderConfigPath({
    agent,
    scope,
    projectDir: options.projectDir,
    configPath: options.configPath
  });
  const metadataPath = resolveMetadataPath({ agent, configPath });

  if (!options.yes) {
    const shouldContinue = await confirmPrompt(
      `Remove AgentCraft ${agent} integration from ${configPath}?`
    );
    if (!shouldContinue) {
      process.stdout.write("Cancelled.\n");
      return;
    }
  }

  const metadata = await resolveExistingMetadata(metadataPath);

  const result =
    agent === "claude"
      ? await withSpinner(
          "Removing managed hooks",
          async () => {
            const settings = await readSettings(configPath);
            const removed = uninstallManagedHooks(settings);
            delete settings.agentcraft;
            await writeSettings(configPath, settings);
            return { removed: removed.removed };
          },
          "Removed managed hooks"
        )
      : await withSpinner(
          "Removing managed Codex hooks",
          async () => {
            const hooksRemoved = await uninstallManagedCodexHooks(configPath);
            const notifyRemoved = await uninstallManagedCodexNotify(configPath);
            await uninstallManagedCodexHooksFeature(configPath);
            return { removed: hooksRemoved.removed + (notifyRemoved.removed ? 1 : 0) };
          },
          "Removed managed Codex hooks"
        );

  const removedStateFile = await removeIfExists(metadata?.stateFile);
  const removedMetadata = await deleteAgentcraftMetadata(metadataPath);

  process.stdout.write(`Agent: ${agent}\n`);
  process.stdout.write(`Config: ${configPath}\n`);
  process.stdout.write(`Removed integrations: ${result.removed}\n`);
  process.stdout.write(
    `Removed metadata: ${removedMetadata ? metadataPath : "(none found)"}\n`
  );
  process.stdout.write(
    `Removed state file: ${
      removedStateFile ? metadata?.stateFile : "(none found)"
    }\n`
  );
  process.stdout.write(result.removed === 0 ? "No matching integration found.\n" : "Uninstall complete.\n");
  showOutro(result.removed === 0 ? "No integration to remove" : "Uninstall complete");
}

async function resolveExistingMetadata(metadataPath: string) {
  return await readAgentcraftMetadata(metadataPath);
}

async function removeIfExists(targetPath: string | undefined): Promise<boolean> {
  if (!targetPath) {
    return false;
  }

  if (!(await pathExists(targetPath))) {
    return false;
  }

  await fs.unlink(targetPath);
  return true;
}
