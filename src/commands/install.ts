import path from "node:path";
import {
  buildAgentcraftMetadata,
  formatScopeLabel,
  resolveDefaultStateFilePath,
  resolveMetadataPath,
  writeAgentcraftMetadata
} from "../lib/agentcraft-config.js";
import { resolveAgentProvider, resolveProviderConfigPath } from "../lib/agent-provider.js";
import { readSettings, writeSettings } from "../lib/claude-config.js";
import {
  upsertManagedCodexHooks,
  upsertManagedCodexHooksFeature,
  upsertManagedCodexNotify
} from "../lib/codex-config.js";
import { normalizeFailureCooldown, normalizeToolCooldown } from "../lib/failure-logic.js";
import { installManagedHook } from "../lib/hooks-merge.js";
import { readManifest } from "../lib/manifest.js";
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
  PRESET_EVENTS,
  RACES,
  type HookPreset,
  type InstallOptions,
  type InstallScope,
  type RaceOption
} from "../lib/types.js";

export async function runInstall(
  options: InstallOptions,
  runtime: { packageRoot: string }
): Promise<void> {
  const agent = await resolveAgentProvider(options.agent);
  const race =
    options.race ??
    (await selectPrompt<RaceOption>("Race:", [
      { label: "Protoss", value: "protoss" },
      { label: "Terran", value: "terran" },
      { label: "Zerg", value: "zerg" },
      { label: "Random", value: "random" }
    ]));

  const scope =
    options.scope ??
    (await selectPrompt<InstallScope>("Install scope:", [
      { label: formatScopeLabel({ agent, scope: "project" }), value: "project" },
      { label: formatScopeLabel({ agent, scope: "global" }), value: "global" }
    ]));

  const preset =
    agent === "claude"
      ? options.preset ??
        (await selectPrompt<HookPreset>("Hook preset:", [
          { label: "Core (SessionStart, Stop, Notification)", value: "core" },
          {
            label: "Expanded (+PreToolUse, PostToolUse, UserPromptSubmit)",
            value: "expanded"
          }
        ]))
      : "core";

  const configPath = resolveProviderConfigPath({
    agent,
    scope,
    projectDir: options.projectDir,
    configPath: options.configPath
  });
  const metadataPath = resolveMetadataPath({ agent, configPath });
  const manifestPath = path.join(runtime.packageRoot, "assets", "manifest.json");
  const playerScriptPath = path.join(runtime.packageRoot, "dist", "player", "play-sound.js");
  const stateFilePath = resolveDefaultStateFilePath({ agent, configPath });
  const toolCooldownSec = normalizeToolCooldown(options.toolCooldownSec);
  const failureCooldownSec = normalizeFailureCooldown(options.failureCooldownSec);
  const failureFilter = options.failureFilter ?? true;

  if (!RACES.includes(race)) {
    throw new Error(`Invalid race: ${race}`);
  }

  const sounds = await withSpinner(
    "Validating manifest and sounds",
    async () => {
      await readManifest(manifestPath);
      return ensureSoundsAvailable({
        packageRoot: runtime.packageRoot,
        manifestPath,
        explicitSoundsDir: options.soundsDir,
        verbose: options.verbose
      });
    },
    (value) => `Sounds ready (${value.downloaded} downloaded)`
  );

  if (!options.yes) {
    const actionLabel =
      agent === "claude"
        ? `Install ${preset} preset (${race}) hooks into ${configPath}?`
        : `Install Codex sound hooks (${race}) into ${configPath}?`;
    const shouldContinue = await confirmPrompt(actionLabel);
    if (!shouldContinue) {
      process.stdout.write("Cancelled.\n");
      return;
    }
  }

  const result =
    agent === "claude"
      ? await installClaudeManagedHooks({
          configPath,
          manifestPath,
          playerScriptPath,
          race,
          preset,
          stateFilePath,
          soundsDir: sounds.soundsDir,
          toolCooldownSec,
          failureCooldownSec,
          failureFilter
        })
      : await installCodexManagedNotify({
          configPath,
          manifestPath,
          playerScriptPath,
          race,
          stateFilePath,
          soundsDir: sounds.soundsDir,
          toolCooldownSec,
          failureCooldownSec,
          failureFilter
        });

  const metadata = buildAgentcraftMetadata({
    agent,
    configPath,
    race,
    soundsDir: sounds.soundsDir,
    toolCooldownSec,
    failureCooldownSec,
    failureFilter,
    stateFile: stateFilePath,
    preset
  });

  await withSpinner(
    "Writing AgentCraft metadata",
    async () => {
      await writeAgentcraftMetadata(metadataPath, metadata);
    },
    "Metadata saved"
  );

  process.stdout.write(`Agent: ${agent}\n`);
  process.stdout.write(`Config: ${configPath}\n`);
  if (agent === "claude") {
    process.stdout.write(`Preset: ${preset}\n`);
  } else {
    process.stdout.write(
      "Codex events: SessionStart, Stop, agent-turn-complete -> Notification\n"
    );
  }
  process.stdout.write(`Race: ${race}\n`);
  process.stdout.write(`Sounds dir: ${sounds.soundsDir}\n`);
  process.stdout.write(`Downloaded sounds: ${sounds.downloaded}\n`);
  process.stdout.write(`Tool cooldown: ${toolCooldownSec}s\n`);
  process.stdout.write(`Failure cooldown: ${failureCooldownSec}s\n`);
  process.stdout.write(`Failure filter: ${failureFilter ? "on" : "off"}\n`);
  process.stdout.write(`Metadata: ${metadataPath}\n`);
  process.stdout.write(`State file: ${stateFilePath}\n`);
  process.stdout.write(`Added integrations: ${result.added}\n`);
  process.stdout.write(`Updated integrations: ${result.updated}\n`);
  process.stdout.write(
    result.added === 0 && result.updated === 0
      ? "No changes (already installed with same settings).\n"
      : `Install complete. Restart ${agent === "claude" ? "Claude Code" : "Codex"} if needed.\n`
  );
  showOutro(result.added === 0 && result.updated === 0 ? "No changes" : "Install complete");
}

async function installClaudeManagedHooks(input: {
  configPath: string;
  manifestPath: string;
  playerScriptPath: string;
  race: RaceOption;
  preset: HookPreset;
  stateFilePath: string;
  soundsDir: string;
  toolCooldownSec: number;
  failureCooldownSec: number;
  failureFilter: boolean;
}): Promise<{ added: number; updated: number }> {
  const settings = await readSettings(input.configPath);
  return await withSpinner(
    "Installing managed hooks",
    async () => {
      let added = 0;
      let updated = 0;
      for (const event of PRESET_EVENTS[input.preset]) {
        const command = buildClaudeHookCommand({
          playerScriptPath: input.playerScriptPath,
          agent: "claude",
          event,
          race: input.race,
          manifestPath: input.manifestPath,
          stateFilePath: input.stateFilePath,
          soundsDir: input.soundsDir,
          toolCooldownSec: input.toolCooldownSec,
          failureCooldownSec: input.failureCooldownSec,
          failureFilter: input.failureFilter
        });
        const result = installManagedHook(settings, event, command);
        if (result.added) {
          added += 1;
        }
        if (result.updated) {
          updated += 1;
        }
      }

      await writeSettings(input.configPath, settings);
      return { added, updated };
    },
    (value) => `Hooks ready (${value.added} added, ${value.updated} updated)`
  );
}

async function installCodexManagedNotify(input: {
  configPath: string;
  manifestPath: string;
  playerScriptPath: string;
  race: RaceOption;
  stateFilePath: string;
  soundsDir: string;
  toolCooldownSec: number;
  failureCooldownSec: number;
  failureFilter: boolean;
}): Promise<{ added: number; updated: number }> {
  return await withSpinner(
    "Installing managed Codex hooks",
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
            stateFilePath: input.stateFilePath,
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
          stateFilePath: input.stateFilePath,
          soundsDir: input.soundsDir,
          toolCooldownSec: input.toolCooldownSec,
          failureCooldownSec: input.failureCooldownSec,
          failureFilter: input.failureFilter
        })
      });
      return {
        added: hooksResult.added + (result.added ? 1 : 0),
        updated: hooksResult.updated + (result.updated ? 1 : 0)
      };
    },
    (value) => `Codex hooks ready (${value.added} added, ${value.updated} updated)`
  );
}
