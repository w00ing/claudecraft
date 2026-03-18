import {
  MANAGED_BY,
  type AgentProvider,
  type CodexHookEventName,
  type CodexNotifyEventName,
  type HookEventName,
  type RaceOption
} from "./types.js";

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function normalizedForShell(filePath: string): string {
  return process.platform === "win32" ? filePath.replace(/\\/g, "/") : filePath;
}

interface PlaybackCommandInput {
  playerScriptPath: string;
  agent: AgentProvider;
  race: RaceOption;
  manifestPath: string;
  stateFilePath: string;
  soundsDir: string;
  toolCooldownSec: number;
  failureCooldownSec: number;
  failureFilter: boolean;
}

function buildBaseParts(input: PlaybackCommandInput): string[] {
  const scriptPath = normalizedForShell(input.playerScriptPath);
  const manifestPath = normalizedForShell(input.manifestPath);
  const stateFilePath = normalizedForShell(input.stateFilePath);
  const soundsDir = normalizedForShell(input.soundsDir);
  const parts = [
    "node",
    quote(scriptPath),
    "--agent",
    quote(input.agent),
    "--race",
    quote(input.race),
    "--manifest",
    quote(manifestPath),
    "--state-file",
    quote(stateFilePath),
    "--sounds-dir",
    quote(soundsDir),
    "--tool-cooldown",
    quote(String(input.toolCooldownSec)),
    "--failure-cooldown",
    quote(String(input.failureCooldownSec)),
    "--managed-by",
    quote(MANAGED_BY)
  ];

  if (!input.failureFilter) {
    parts.push("--no-failure-filter");
  }

  return parts;
}

export function buildClaudeHookCommand(
  input: PlaybackCommandInput & {
    event: HookEventName;
  }
): string {
  return [
    ...buildBaseParts(input).slice(0, 2),
    "--event",
    quote(input.event),
    ...buildBaseParts(input).slice(2)
  ].join(" ");
}

export function buildCodexHookCommand(
  input: PlaybackCommandInput & {
    event: CodexHookEventName;
  }
): string {
  return [
    ...buildBaseParts(input).slice(0, 2),
    "--event",
    quote(input.event),
    ...buildBaseParts(input).slice(2)
  ].join(" ");
}

export function buildCodexNotifyCommand(
  input: PlaybackCommandInput & {
    notifyEvent: CodexNotifyEventName;
    event: HookEventName;
  }
): string[] {
  return [
    "node",
    normalizedForShell(input.playerScriptPath),
    "--agent",
    input.agent,
    "--notify-event",
    input.notifyEvent,
    "--event",
    input.event,
    "--race",
    input.race,
    "--manifest",
    normalizedForShell(input.manifestPath),
    "--state-file",
    normalizedForShell(input.stateFilePath),
    "--sounds-dir",
    normalizedForShell(input.soundsDir),
    "--tool-cooldown",
    String(input.toolCooldownSec),
    "--failure-cooldown",
    String(input.failureCooldownSec),
    "--managed-by",
    MANAGED_BY,
    ...(input.failureFilter ? [] : ["--no-failure-filter"])
  ];
}
