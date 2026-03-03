import type {
  FixedRace,
  GameEventDelta,
  GameEventLogEntry,
  GameProductionItem,
  GameState,
  HookEventName
} from "./types.js";

interface UnitRule {
  type: string;
  cost: number;
  buildTicks: number;
}

interface RaceUnitRules {
  worker: UnitRule;
  light: UnitRule;
  heavy: UnitRule;
}

const STARTING_MINERALS = 50;
const STARTING_WORKERS = 4;
const MINERALS_PER_WORKER_TICK = 8;
const MAX_RECENT_EVENTS = 25;

const UNIT_RULES: Record<FixedRace, RaceUnitRules> = {
  protoss: {
    worker: { type: "Probe", cost: 50, buildTicks: 3 },
    light: { type: "Zealot", cost: 100, buildTicks: 5 },
    heavy: { type: "Dragoon", cost: 125, buildTicks: 6 }
  },
  terran: {
    worker: { type: "SCV", cost: 50, buildTicks: 3 },
    light: { type: "Marine", cost: 50, buildTicks: 2 },
    heavy: { type: "Vulture", cost: 75, buildTicks: 4 }
  },
  zerg: {
    worker: { type: "Drone", cost: 50, buildTicks: 3 },
    light: { type: "Zergling", cost: 50, buildTicks: 2 },
    heavy: { type: "Hydralisk", cost: 75, buildTicks: 4 }
  }
};

export function createInitialGameState(race: FixedRace): GameState {
  return {
    version: 1,
    race,
    tick: 0,
    minerals: STARTING_MINERALS,
    gas: 0,
    workers: STARTING_WORKERS,
    workersMining: STARTING_WORKERS,
    units: {
      [UNIT_RULES[race].worker.type]: STARTING_WORKERS
    },
    productionQueue: [],
    stats: {
      eventsHandled: 0,
      failures: 0,
      lastEventAt: undefined
    },
    recentEvents: []
  };
}

export function applyGameEvent(input: {
  state: GameState;
  race: FixedRace;
  event: HookEventName;
  atIso: string;
  payloadSummary?: string;
}): { state: GameState; delta: GameEventDelta } {
  const state = input.event === "SessionStart" ? createInitialGameState(input.race) : input.state;
  if (state.race !== input.race) {
    state.race = input.race;
  }

  const before = {
    minerals: state.minerals,
    gas: state.gas,
    workers: state.workers
  };

  const rules = UNIT_RULES[state.race];
  state.tick += 1;
  collectMinerals(state);
  completeFinishedProduction(state);

  let note = "Event applied";

  switch (input.event) {
    case "UserPromptSubmit": {
      state.minerals += 20;
      note = `Command center acknowledged. +20 minerals`;
      queueIfAffordable(state, rules.worker);
      break;
    }
    case "PreToolUse": {
      note = `Production request enqueued`;
      queueIfAffordable(state, rules.light);
      break;
    }
    case "PostToolUse": {
      state.minerals += 15;
      note = `Task complete. Mining boost +15 minerals`;
      advanceQueueByBonusTick(state);
      queueIfAffordable(state, rules.heavy);
      break;
    }
    case "PostToolUseFailure": {
      state.minerals = Math.max(0, state.minerals - 25);
      state.stats.failures += 1;
      note = `Structure damaged. -25 minerals`;
      break;
    }
    case "Notification": {
      state.minerals += 10;
      note = `Transmission received. +10 minerals`;
      break;
    }
    case "Stop": {
      note = `Production paused`;
      break;
    }
    case "SessionStart": {
      note = `New operation initialized`;
      break;
    }
  }

  state.stats.eventsHandled += 1;
  state.stats.lastEventAt = input.atIso;

  const delta: GameEventDelta = {
    minerals: state.minerals - before.minerals,
    gas: state.gas - before.gas,
    workers: state.workers - before.workers,
    note
  };

  appendEventLog(state, {
    sourceEvent: input.event,
    at: input.atIso,
    tick: state.tick,
    payloadSummary: input.payloadSummary,
    delta
  });

  return { state, delta };
}

function appendEventLog(state: GameState, entry: GameEventLogEntry): void {
  state.recentEvents.push(entry);
  if (state.recentEvents.length > MAX_RECENT_EVENTS) {
    state.recentEvents.splice(0, state.recentEvents.length - MAX_RECENT_EVENTS);
  }
}

function collectMinerals(state: GameState): void {
  state.minerals += state.workersMining * MINERALS_PER_WORKER_TICK;
}

function completeFinishedProduction(state: GameState): void {
  const complete = state.productionQueue.filter((item) => item.finishAtTick <= state.tick);
  if (complete.length === 0) {
    return;
  }

  state.productionQueue = state.productionQueue.filter((item) => item.finishAtTick > state.tick);
  for (const item of complete) {
    state.units[item.unitType] = (state.units[item.unitType] ?? 0) + 1;
    if (isWorkerUnit(item.unitType)) {
      state.workers += 1;
      state.workersMining += 1;
    }
  }
}

function advanceQueueByBonusTick(state: GameState): void {
  if (state.productionQueue.length === 0) {
    return;
  }

  for (const item of state.productionQueue) {
    item.finishAtTick = Math.max(state.tick, item.finishAtTick - 1);
  }
  completeFinishedProduction(state);
}

function queueIfAffordable(state: GameState, rule: UnitRule): boolean {
  if (state.minerals < rule.cost) {
    return false;
  }

  state.minerals -= rule.cost;
  const queueItem: GameProductionItem = {
    id: `${state.tick}-${state.productionQueue.length + 1}-${rule.type.toLowerCase()}`,
    unitType: rule.type,
    startedAtTick: state.tick,
    finishAtTick: state.tick + rule.buildTicks
  };
  state.productionQueue.push(queueItem);
  return true;
}

function isWorkerUnit(unitType: string): boolean {
  return unitType === "SCV" || unitType === "Probe" || unitType === "Drone";
}

export function summarizePayload(payload: unknown): string | undefined {
  if (payload === undefined) {
    return undefined;
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) {
      return undefined;
    }
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }

  try {
    const serialized = JSON.stringify(payload);
    if (!serialized || serialized === "{}") {
      return undefined;
    }
    return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized;
  } catch {
    return undefined;
  }
}
