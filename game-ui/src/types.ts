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
  sourceEvent: string;
  at: string;
  tick: number;
  payloadSummary?: string;
  delta: GameEventDelta;
}

export interface GameState {
  version: 1;
  race: "protoss" | "terran" | "zerg";
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

export interface GameStateEnvelope {
  state: GameState;
  sessionStatus: "live" | "idle";
  lastEventAt?: string;
  idleSeconds?: number;
  boundGameStatePath: string;
}

export interface RuntimeConfig {
  idleThresholdSec: number;
  apiBase: string;
  race: "protoss" | "terran" | "zerg";
  uiTheme: "protoss" | "terran" | "zerg";
  viewAspect: "4:3";
  assetPack: "open-rts" | "placeholder" | "starcraft-local";
  assetRevision: number;
}
