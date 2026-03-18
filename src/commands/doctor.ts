import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readAgentcraftMetadata, resolveMetadataPath } from "../lib/agentcraft-config.js";
import { resolveAgentProvider, resolveProviderConfigPath } from "../lib/agent-provider.js";
import { pathExists, readSettings } from "../lib/claude-config.js";
import {
  readManagedCodexHooksFeatureState,
  readManagedCodexHooksState,
  readManagedCodexNotifyState
} from "../lib/codex-config.js";
import { listInstalledManagedEvents } from "../lib/hooks-merge.js";
import {
  listAllManifestFiles,
  readManifest,
  resolveSelection,
  resolveSoundPath
} from "../lib/manifest.js";
import { showOutro, withSpinner } from "../lib/ui.js";
import {
  ALL_EVENTS,
  FIXED_RACES,
  type DoctorOptions,
  type HookEventName,
  type InstallScope,
  type RaceOption
} from "../lib/types.js";

interface DoctorReport {
  agent: "claude" | "codex";
  configPath: string;
  configFound: boolean;
  metadataPath: string;
  metadataFound: boolean;
  installedEvents: string[];
  codexHooksFeatureEnabled?: boolean;
  codexHooksPath?: string;
  codexHooksParseError?: string;
  configuredRace?: RaceOption;
  soundsDir?: string;
  toolCooldownSec?: number;
  failureCooldownSec?: number;
  failureFilter?: boolean;
  missingSoundFiles: string[];
  missingMappings: string[];
  playbackSupport: {
    platform: NodeJS.Platform;
    supported: boolean;
    detail: string;
  };
}

function hasCommand(name: string): boolean {
  const probe =
    process.platform === "win32"
      ? spawnSync("where", [name], { stdio: "ignore" })
      : spawnSync("which", [name], { stdio: "ignore" });
  return probe.status === 0;
}

function playbackStatus(): DoctorReport["playbackSupport"] {
  if (process.platform === "darwin") {
    return {
      platform: process.platform,
      supported: hasCommand("afplay"),
      detail: hasCommand("afplay") ? "afplay available" : "afplay is not installed"
    };
  }

  if (process.platform === "linux") {
    if (hasCommand("aplay")) {
      return { platform: process.platform, supported: true, detail: "aplay available" };
    }
    if (hasCommand("paplay")) {
      return { platform: process.platform, supported: true, detail: "paplay available" };
    }
    return {
      platform: process.platform,
      supported: false,
      detail: "Neither aplay nor paplay is installed"
    };
  }

  if (process.platform === "win32") {
    return {
      platform: process.platform,
      supported: hasCommand("powershell"),
      detail: hasCommand("powershell")
        ? "powershell available"
        : "powershell is not available in PATH"
    };
  }

  return {
    platform: process.platform,
    supported: false,
    detail: "Unsupported platform"
  };
}

export async function runDoctor(
  options: DoctorOptions,
  runtime: { packageRoot: string }
): Promise<void> {
  const agent = await resolveAgentProvider(options.agent);
  const scope = (options.scope ?? "project") as InstallScope;
  const configPath = resolveProviderConfigPath({
    agent,
    scope,
    projectDir: options.projectDir,
    configPath: options.configPath
  });
  const metadataPath = resolveMetadataPath({ agent, configPath });

  const report: DoctorReport = {
    agent,
    configPath,
    configFound: false,
    metadataPath,
    metadataFound: false,
    installedEvents: [],
    configuredRace: undefined,
    soundsDir: undefined,
    toolCooldownSec: undefined,
    failureCooldownSec: undefined,
    failureFilter: undefined,
    missingSoundFiles: [],
    missingMappings: [],
    playbackSupport: playbackStatus()
  };

  await withSpinner(
    `Inspecting ${agent === "claude" ? "Claude" : "Codex"} config`,
    async () => {
      report.configFound = await pathExists(configPath);
      const metadata = await readAgentcraftMetadata(metadataPath);
      if (metadata) {
        report.metadataFound = true;
        report.configuredRace = metadata.race;
        report.soundsDir = metadata.soundsDir;
        report.toolCooldownSec = metadata.toolCooldownSec;
        report.failureCooldownSec = metadata.failureCooldownSec;
        report.failureFilter = metadata.failureFilter;
      }

      if (agent === "claude") {
        const settings = await readSettings(configPath);
        report.installedEvents = listInstalledManagedEvents(settings);
      } else {
        const [notifyState, featureState, hooksState] = await Promise.all([
          readManagedCodexNotifyState(configPath),
          readManagedCodexHooksFeatureState(configPath),
          readManagedCodexHooksState(configPath)
        ]);
        report.codexHooksFeatureEnabled = featureState.codexHooksEnabled;
        report.codexHooksPath = hooksState.hooksPath;
        report.codexHooksParseError = hooksState.parseError;
        report.installedEvents = [
          ...hooksState.installedEvents,
          ...(notifyState.hasManagedNotify ? ["agent-turn-complete -> Notification"] : [])
        ];
      }
    },
    "Config inspected"
  );

  const manifestPath = path.join(runtime.packageRoot, "assets", "manifest.json");
  const manifest = await withSpinner(
    "Validating manifest mappings",
    async () => {
      const loadedManifest = await readManifest(manifestPath);
      for (const race of FIXED_RACES) {
        for (const event of ALL_EVENTS) {
          const selection = resolveSelection(loadedManifest, race, event);
          if (selection.type === "single" && !selection.file) {
            report.missingMappings.push(`${race}.${event}`);
          }
          if (selection.type === "pool" && selection.files.length === 0) {
            report.missingMappings.push(`${race}.${event}`);
          }
        }
      }
      return loadedManifest;
    },
    "Mappings validated"
  );

  await withSpinner(
    "Checking curated sound files",
    async () => {
      for (const fileName of listAllManifestFiles(manifest)) {
        const resolved = resolveSoundPath(manifestPath, manifest, fileName, report.soundsDir);
        try {
          await fs.access(resolved);
        } catch {
          report.missingSoundFiles.push(resolved);
        }
      }
    },
    "Sound file check complete"
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Agent: ${report.agent}\n`);
  process.stdout.write(`Config path: ${report.configPath}\n`);
  process.stdout.write(`Config readable: ${report.configFound ? "yes" : "no"}\n`);
  process.stdout.write(`Metadata path: ${report.metadataPath}\n`);
  process.stdout.write(`Metadata readable: ${report.metadataFound ? "yes" : "no"}\n`);
  process.stdout.write(`Configured race: ${report.configuredRace ?? "(none)"}\n`);
  process.stdout.write(`Sounds dir: ${report.soundsDir ?? "(manifest default)"}\n`);
  process.stdout.write(`Tool cooldown: ${report.toolCooldownSec ?? 2}s\n`);
  process.stdout.write(`Failure cooldown: ${report.failureCooldownSec ?? 15}s\n`);
  process.stdout.write(`Failure filter: ${(report.failureFilter ?? true) ? "on" : "off"}\n`);
  if (report.agent === "codex") {
    process.stdout.write(
      `Codex hooks feature: ${report.codexHooksFeatureEnabled ? "on" : "off"}\n`
    );
    process.stdout.write(`Codex hooks path: ${report.codexHooksPath ?? "(not resolved)"}\n`);
    if (report.codexHooksParseError) {
      process.stdout.write(`Codex hooks parse error: ${report.codexHooksParseError}\n`);
    }
  }
  process.stdout.write(
    `Installed integrations: ${
      report.installedEvents.length ? report.installedEvents.join(", ") : "(none)"
    }\n`
  );
  process.stdout.write(
    `Playback support: ${report.playbackSupport.supported ? "yes" : "no"} (${
      report.playbackSupport.detail
    })\n`
  );
  process.stdout.write(
    report.missingSoundFiles.length
      ? `Missing sound files:\n- ${report.missingSoundFiles.join("\n- ")}\n`
      : "Sound files: all present\n"
  );
  process.stdout.write(
    report.missingMappings.length
      ? `Missing mappings:\n- ${report.missingMappings.join("\n- ")}\n`
      : "Mappings: all present\n"
  );
  showOutro("Doctor complete");
}
