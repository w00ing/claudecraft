export const MANAGED_BY = "agentcraft";
export const AGENT_PROVIDERS = ["claude", "codex"] as const;

export const ALL_EVENTS = [
  "SessionStart",
  "Stop",
  "Notification",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit"
] as const;

export const PRESET_EVENTS = {
  core: ["SessionStart", "Stop", "Notification"],
  expanded: [
    "SessionStart",
    "Stop",
    "Notification",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit"
  ]
} as const;

export const RACES = ["protoss", "terran", "zerg", "random"] as const;
export const FIXED_RACES = ["protoss", "terran", "zerg"] as const;

export const EVENT_MATCHERS: Partial<Record<HookEventName, string>> = {
  PreToolUse: "Edit|Write|MultiEdit|Bash|Explore",
  PostToolUse: "Edit|Write|MultiEdit|Bash|Explore",
  PostToolUseFailure: "Bash"
};

export const CODEX_HOOK_EVENTS = ["SessionStart", "Stop"] as const;

export type HookEventName = (typeof ALL_EVENTS)[number];
export type HookPreset = keyof typeof PRESET_EVENTS;
export type InstallScope = "project" | "global";
export type RaceOption = (typeof RACES)[number];
export type FixedRace = (typeof FIXED_RACES)[number];
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];
export type CodexNotifyEventName = "agent-turn-complete";
export type CodexHookEventName = (typeof CODEX_HOOK_EVENTS)[number];

export interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
}

export interface HookEntry {
  matcher?: string;
  hooks: CommandHook[];
}

export type HooksMap = Partial<Record<HookEventName, HookEntry[]>>;

export interface ClaudeSettings {
  hooks?: HooksMap;
  agentcraft?: AgentcraftEmbeddedMetadata;
  [key: string]: unknown;
}

export interface SoundSelectionSingle {
  type: "single";
  file: string;
}

export interface SoundSelectionPool {
  type: "pool";
  files: string[];
}

export type SoundSelection = SoundSelectionSingle | SoundSelectionPool;

export interface SoundManifest {
  version: number;
  sourceRoot: string;
  random: {
    strategy: "session-sticky";
  };
  races: Record<FixedRace, Record<HookEventName, SoundSelection>>;
}

export interface AgentcraftSettingsMetadata {
  race: RaceOption;
  source: string;
  manifestVersion: number;
  stateFile: string;
  soundsDir: string;
  toolCooldownSec: number;
  failureCooldownSec: number;
  failureFilter: boolean;
  installedAt: string;
}

export interface AgentcraftEmbeddedMetadata extends AgentcraftSettingsMetadata {
  agent: AgentProvider;
  configPath?: string;
  preset?: HookPreset;
}

export interface AgentcraftMetadata {
  version: 1;
  agent: AgentProvider;
  race: RaceOption;
  source: string;
  manifestVersion: number;
  stateFile: string;
  soundsDir: string;
  toolCooldownSec: number;
  failureCooldownSec: number;
  failureFilter: boolean;
  installedAt: string;
  configPath: string;
  preset?: HookPreset;
}

export interface InstallOptions {
  agent?: AgentProvider;
  scope?: InstallScope;
  preset?: HookPreset;
  race?: RaceOption;
  soundsDir?: string;
  configPath?: string;
  projectDir?: string;
  yes?: boolean;
  verbose?: boolean;
  toolCooldownSec?: number;
  failureCooldownSec?: number;
  failureFilter?: boolean;
}

export interface SwitchOptions {
  agent?: AgentProvider;
  scope?: InstallScope;
  race?: RaceOption;
  soundsDir?: string;
  configPath?: string;
  projectDir?: string;
  yes?: boolean;
  verbose?: boolean;
  toolCooldownSec?: number;
  failureCooldownSec?: number;
  failureFilter?: boolean;
}

export interface UninstallOptions {
  agent?: AgentProvider;
  scope?: InstallScope;
  configPath?: string;
  projectDir?: string;
  yes?: boolean;
  verbose?: boolean;
}

export interface DoctorOptions {
  agent?: AgentProvider;
  scope?: InstallScope;
  configPath?: string;
  projectDir?: string;
  json?: boolean;
  verbose?: boolean;
}

export type GameAssetPackName = "kenney-rts" | "open-rts" | "placeholder" | "starcraft-local";

export const GAME_ASSET_KEYS = [
  "worker",
  "base",
  "mineralPatch",
  "unitLight",
  "unitHeavy",
  "queue",
  "terrainTile",
  "terrainCreep",
  "uiTopTerran",
  "uiBottomTerran",
  "uiTopProtoss",
  "uiBottomProtoss",
  "uiTopZerg",
  "uiBottomZerg",
  "minimapFrame",
  "iconMinerals",
  "iconSupply",
  "portraitWorkerTerran",
  "portraitWorkerProtoss",
  "portraitWorkerZerg",
  "commandMove",
  "commandStop",
  "commandHold"
] as const;

export type GameAssetKey = (typeof GAME_ASSET_KEYS)[number];

export interface GameAssetPackDefinition {
  source: "bundled" | "generated" | "user";
  files: Record<GameAssetKey, string>;
}

export interface GameAssetsManifest {
  version: number;
  defaultPack: GameAssetPackName;
  packs: Record<GameAssetPackName, GameAssetPackDefinition>;
}

export interface GameAssetUserConfig {
  selectedPack: GameAssetPackName;
  customPackDir?: string;
  installedAt: string;
}

export interface GameProductionItem {
  id: string;
  unitType: string;
  startedAtTick: number;
  finishAtTick: number;
}

export interface GameEventDelta {
  minerals: number;
  gas: number;
  workers: number;
  note: string;
}

export interface GameEventLogEntry {
  sourceEvent: HookEventName;
  at: string;
  tick: number;
  payloadSummary?: string;
  delta: GameEventDelta;
}

export interface GameState {
  version: 1;
  race: FixedRace;
  tick: number;
  minerals: number;
  gas: number;
  workers: number;
  workersMining: number;
  units: Record<string, number>;
  productionQueue: GameProductionItem[];
  stats: {
    eventsHandled: number;
    failures: number;
    lastEventAt?: string;
  };
  recentEvents: GameEventLogEntry[];
}

export type GameSessionStatus = "live" | "idle";

export interface GameStateEnvelope {
  state: GameState;
  sessionStatus: GameSessionStatus;
  lastEventAt?: string;
  idleSeconds?: number;
  boundGameStatePath: string;
}

export type GameUiMode = "phaser" | "legacy";
export type GameUiTheme = "terran" | "protoss" | "zerg";

export interface GameUiRuntimeConfig {
  idleThresholdSec: number;
  apiBase: string;
  race: FixedRace;
  uiTheme: GameUiTheme;
  viewAspect: "4:3";
  assetPack: GameAssetPackName;
  assetRevision: number;
}

export interface GameCommandCommonOptions {
  agent?: AgentProvider;
  scope?: InstallScope;
  configPath?: string;
  projectDir?: string;
  verbose?: boolean;
}

export interface GameWatchOptions extends GameCommandCommonOptions {
  port?: number;
  open?: boolean;
  idleThresholdSec?: number;
  uiMode?: GameUiMode;
  uiTheme?: GameUiTheme | "auto";
  assetPack?: GameAssetPackName;
}

export interface GameStatusOptions extends GameCommandCommonOptions {
  json?: boolean;
}

export interface GameResetOptions extends GameCommandCommonOptions {
  yes?: boolean;
}

export interface GameAssetsInstallOptions {
  pack?: GameAssetPackName;
  assetsDir?: string;
  verbose?: boolean;
}

export interface GameAssetsDoctorOptions {
  json?: boolean;
}
