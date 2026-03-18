import path from "node:path";
import {
  buildAgentcraftMetadata,
  formatScopeLabel,
  readAgentcraftMetadata,
  resolveMetadataPath,
  writeAgentcraftMetadata
} from "../lib/agentcraft-config.js";
import { resolveAgentProvider, resolveProviderConfigPath } from "../lib/agent-provider.js";
import { readSettings, writeSettings } from "../lib/claude-config.js";
import {
  upsertManagedCodexHooks,
  upsertManagedCodexHooksFeature,
  readManagedCodexNotifyState,
  upsertManagedCodexNotify
} from "../lib/codex-config.js";
import { normalizeFailureCooldown, normalizeToolCooldown } from "../lib/failure-logic.js";
import { installManagedHook, listInstalledManagedEvents } from "../lib/hooks-merge.js";
import {
  buildClaudeHookCommand,
  buildCodexHookCommand,
  buildCodexNotifyCommand
} from "../lib/playback-command.js";
import { confirmPrompt, selectPrompt } from "../lib/prompt.js";
import { ensureSoundsAvailable } from "../lib/sounds.js";
import { showOutro, withSpinner } from "../lib/ui.js";
import {
  CODEX_HOOK_EVENTS,
  type InstallScope,
  type RaceOption,
  type SwitchOptions
} from "../lib/types.js";

export async function runSwitch(
  options: SwitchOptions,
  runtime: { packageRoot: string }
): Promise<void> {
  const agent = await resolveAgentProvider(options.agent);
  const race =
    options.race ??
    (await selectPrompt<RaceOption>("Switch to race:", [
      { label: "Protoss", value: "protoss" },
      { label: "Terran", value: "terran" },
      { label: "Zerg", value: "zerg" },
      { label: "Random", value: "random" }
    ]));

  const scope =
    options.scope ??
    (await selectPrompt<InstallScope>("Switch scope:", [
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
  const metadata = await resolveExistingMetadata(metadataPath);
  if (!metadata) {
    throw new Error(`No existing ${agent} AgentCraft installation found. Run install first.`);
  }

  const manifestPath = path.join(runtime.packageRoot, "assets", "manifest.json");
  const playerScriptPath = path.join(runtime.packageRoot, "dist", "player", "play-sound.js");
  const toolCooldownSec = normalizeToolCooldown(options.toolCooldownSec ?? metadata.toolCooldownSec);
  const failureCooldownSec = normalizeFailureCooldown(
    options.failureCooldownSec ?? metadata.failureCooldownSec
  );
  const failureFilter = options.failureFilter ?? metadata.failureFilter;

  const sounds = await withSpinner(
    "Preparing race sound pack",
    async () =>
      ensureSoundsAvailable({
        packageRoot: runtime.packageRoot,
        manifestPath,
        explicitSoundsDir: options.soundsDir ?? metadata.soundsDir,
        verbose: options.verbose
      }),
    (value) => `Sounds ready (${value.downloaded} downloaded)`
  );

  if (!options.yes) {
    const shouldContinue = await confirmPrompt(
      `Switch ${agent} race to ${race} in ${configPath}?`
    );
    if (!shouldContinue) {
      process.stdout.write("Cancelled.\n");
      return;
    }
  }

  const updated =
    agent === "claude"
      ? await switchClaudeHooks({
          configPath,
          manifestPath,
          playerScriptPath,
          metadata,
          race,
          soundsDir: sounds.soundsDir,
          toolCooldownSec,
          failureCooldownSec,
          failureFilter
        })
      : await switchCodexNotify({
          configPath,
          manifestPath,
          playerScriptPath,
          metadata,
          race,
          soundsDir: sounds.soundsDir,
          toolCooldownSec,
          failureCooldownSec,
          failureFilter
        });

  const nextMetadata = buildAgentcraftMetadata({
    agent,
    configPath,
    race,
    soundsDir: sounds.soundsDir,
    toolCooldownSec,
    failureCooldownSec,
    failureFilter,
    stateFile: metadata.stateFile,
    installedAt: metadata.installedAt,
    preset: metadata.preset
  });

  await withSpinner(
    "Writing AgentCraft metadata",
    async () => {
      await writeAgentcraftMetadata(metadataPath, nextMetadata);
    },
    "Metadata saved"
  );

  process.stdout.write(`Agent: ${agent}\n`);
  process.stdout.write(`Config: ${configPath}\n`);
  process.stdout.write(`Race: ${race}\n`);
  process.stdout.write(`Updated integrations: ${updated}\n`);
  process.stdout.write(`Tool cooldown: ${toolCooldownSec}s\n`);
  process.stdout.write(`Failure cooldown: ${failureCooldownSec}s\n`);
  process.stdout.write(`Failure filter: ${failureFilter ? "on" : "off"}\n`);
  process.stdout.write("Switch complete.\n");
  showOutro("Switch complete");
}

async function resolveExistingMetadata(metadataPath: string) {
  return await readAgentcraftMetadata(metadataPath);
}

async function switchClaudeHooks(input: {
  configPath: string;
  manifestPath: string;
  playerScriptPath: string;
  metadata: NonNullable<Awaited<ReturnType<typeof resolveExistingMetadata>>>;
  race: RaceOption;
  soundsDir: string;
  toolCooldownSec: number;
  failureCooldownSec: number;
  failureFilter: boolean;
}): Promise<number> {
  const settings = await readSettings(input.configPath);
  const installedEvents = listInstalledManagedEvents(settings);
  if (installedEvents.length === 0) {
    throw new Error("No managed Claude hooks found. Run install first.");
  }

  return await withSpinner(
    "Updating managed hooks",
    async () => {
      let updated = 0;
      for (const event of installedEvents) {
        const command = buildClaudeHookCommand({
          playerScriptPath: input.playerScriptPath,
          agent: "claude",
          event,
          race: input.race,
          manifestPath: input.manifestPath,
          stateFilePath: input.metadata.stateFile,
          soundsDir: input.soundsDir,
          toolCooldownSec: input.toolCooldownSec,
          failureCooldownSec: input.failureCooldownSec,
          failureFilter: input.failureFilter
        });

        const result = installManagedHook(settings, event, command);
        if (result.updated || result.added) {
          updated += 1;
        }
      }
      await writeSettings(input.configPath, settings);
      return updated;
    },
    (value) => `Updated ${value} hook${value === 1 ? "" : "s"}`
  );
}

async function switchCodexNotify(input: {
  configPath: string;
  manifestPath: string;
  playerScriptPath: string;
  metadata: NonNullable<Awaited<ReturnType<typeof resolveExistingMetadata>>>;
  race: RaceOption;
  soundsDir: string;
  toolCooldownSec: number;
  failureCooldownSec: number;
  failureFilter: boolean;
}): Promise<number> {
  const state = await readManagedCodexNotifyState(input.configPath);
  if (!state.hasManagedNotify) {
    process.stdout.write(
      "Managed Codex notify command not found; recreating notify and native hooks.\n"
    );
  }

  return await withSpinner(
    "Updating managed Codex hooks",
    async () => {
      await upsertManagedCodexHooksFeature(input.configPath);
      const hooksResult = await upsertManagedCodexHooks({
        configPath: input.configPath,
        hooks: CODEX_HOOK_EVENTS.map((event) => ({
          event,
          command: buildCodexHookCommand({
            playerScriptPath: input.playerScriptPath,
            agent: "codex",
            event,
            race: input.race,
            manifestPath: input.manifestPath,
            stateFilePath: input.metadata.stateFile,
            soundsDir: input.soundsDir,
            toolCooldownSec: input.toolCooldownSec,
            failureCooldownSec: input.failureCooldownSec,
            failureFilter: input.failureFilter
          })
        }))
      });
      const result = await upsertManagedCodexNotify({
        configPath: input.configPath,
        command: buildCodexNotifyCommand({
          playerScriptPath: input.playerScriptPath,
          agent: "codex",
          notifyEvent: "agent-turn-complete",
          event: "Notification",
          race: input.race,
          manifestPath: input.manifestPath,
          stateFilePath: input.metadata.stateFile,
          soundsDir: input.soundsDir,
          toolCooldownSec: input.toolCooldownSec,
          failureCooldownSec: input.failureCooldownSec,
          failureFilter: input.failureFilter
        })
      });
      return hooksResult.added + hooksResult.updated + (result.updated || result.added ? 1 : 0);
    },
    (value) => `Updated ${value} Codex integration${value === 1 ? "" : "s"}`
  );
}
