import Phaser from "phaser";
import type { GameStateEnvelope, RuntimeConfig } from "./types";

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;
const MAX_VISUAL_WORKERS = 200;
const WORLD_VIEW_X = 10;
const WORLD_VIEW_Y = 102;
const WORLD_VIEW_W = WORLD_WIDTH - 20;
const WORLD_VIEW_H = 414;
const MINIMAP_X = 44;
const MINIMAP_Y = 586;
const MINIMAP_W = 224;
const MINIMAP_H = 88;

interface WorkerAgent {
  sprite?: Phaser.GameObjects.Image;
  fallback?: Phaser.GameObjects.Arc;
  carrying?: Phaser.GameObjects.Arc;
  minimapDot?: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  phase: "toMineral" | "mining" | "toBase" | "deposit";
  targetMineral: number;
  dwell: number;
  speed: number;
}

interface RenderModel {
  envelope?: GameStateEnvelope;
  workers: WorkerAgent[];
}

interface UiPalette {
  accent: number;
  alert: number;
  live: string;
}

class EnvelopeStore {
  private listeners = new Set<(value: GameStateEnvelope) => void>();
  private current?: GameStateEnvelope;

  set(value: GameStateEnvelope): void {
    this.current = value;
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  subscribe(listener: (value: GameStateEnvelope) => void): () => void {
    this.listeners.add(listener);
    if (this.current) {
      listener(this.current);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }
}

class RtsScene extends Phaser.Scene {
  private readonly model: RenderModel = { workers: [] };
  private readonly basePoint = new Phaser.Math.Vector2(255, 345);
  private readonly minerals: Phaser.Math.Vector2[] = [
    new Phaser.Math.Vector2(860, 190),
    new Phaser.Math.Vector2(920, 260),
    new Phaser.Math.Vector2(860, 340),
    new Phaser.Math.Vector2(940, 405),
    new Phaser.Math.Vector2(810, 455)
  ];

  private readonly envelopeStore: EnvelopeStore;
  private readonly runtimeConfig: RuntimeConfig;
  private readonly palette: UiPalette;

  private mineralsText?: Phaser.GameObjects.Text;
  private workersText?: Phaser.GameObjects.Text;
  private queueText?: Phaser.GameObjects.Text;
  private tickText?: Phaser.GameObjects.Text;
  private sessionText?: Phaser.GameObjects.Text;
  private pathText?: Phaser.GameObjects.Text;
  private queueListText?: Phaser.GameObjects.Text;
  private unitsListText?: Phaser.GameObjects.Text;
  private eventsListText?: Phaser.GameObjects.Text;
  private minimapBaseDot?: Phaser.GameObjects.Arc;
  private minimapViewport?: Phaser.GameObjects.Rectangle;

  constructor(envelopeStore: EnvelopeStore, runtimeConfig: RuntimeConfig) {
    super("rts-scene");
    this.envelopeStore = envelopeStore;
    this.runtimeConfig = runtimeConfig;
    this.palette = paletteForRace(runtimeConfig.race);
  }

  preload(): void {
    this.load.image("base", "/game-assets/base");
    this.load.image("worker", "/game-assets/worker");
    this.load.image("mineral", "/game-assets/mineralPatch");
  }

  create(): void {
    this.drawScInspiredShell();
    this.drawWorld();

    this.envelopeStore.subscribe((envelope) => {
      this.model.envelope = envelope;
      this.updateHud(envelope);
      this.reconcileWorkers(envelope.state.workersMining);
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.max(0.001, Math.min(0.05, delta / 1000));
    for (const worker of this.model.workers) {
      this.updateWorker(worker, dt);
      this.syncWorkerVisual(worker);
    }
  }

  private drawScInspiredShell(): void {
    const g = this.add.graphics();

    g.fillGradientStyle(0x040a14, 0x040a14, 0x122943, 0x122943, 1);
    g.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    g.lineStyle(1, 0x1f3349, 0.75);
    for (let x = 0; x < WORLD_WIDTH; x += 32) {
      g.strokeLineShape(new Phaser.Geom.Line(x, 0, x, 520));
    }
    for (let y = 0; y < 520; y += 32) {
      g.strokeLineShape(new Phaser.Geom.Line(0, y, WORLD_WIDTH, y));
    }

    g.fillStyle(0x0d1f32, 0.98);
    g.fillRoundedRect(10, 10, WORLD_WIDTH - 20, 68, 10);
    g.lineStyle(2, 0x426887, 0.9);
    g.strokeRoundedRect(10, 10, WORLD_WIDTH - 20, 68, 10);
    g.lineStyle(1, 0x9cc1dd, 0.45);
    g.strokeRoundedRect(14, 14, WORLD_WIDTH - 28, 60, 8);

    g.fillStyle(0x0f1d2f, 1);
    g.fillRoundedRect(10, 528, WORLD_WIDTH - 20, 182, 12);
    g.lineStyle(2, 0x395a77, 0.95);
    g.strokeRoundedRect(10, 528, WORLD_WIDTH - 20, 182, 12);
    g.lineStyle(1, 0x7da6c5, 0.45);
    g.strokeRoundedRect(14, 532, WORLD_WIDTH - 28, 174, 10);

    g.fillStyle(0x10263a, 1);
    g.fillRoundedRect(24, 542, 266, 158, 8);
    g.fillRoundedRect(298, 542, 506, 158, 8);
    g.fillRoundedRect(812, 542, 212, 158, 8);
    g.fillRoundedRect(1032, 542, 236, 158, 8);

    g.lineStyle(2, 0x305171, 0.9);
    g.strokeRoundedRect(24, 542, 266, 158, 8);
    g.strokeRoundedRect(298, 542, 506, 158, 8);
    g.strokeRoundedRect(812, 542, 212, 158, 8);
    g.strokeRoundedRect(1032, 542, 236, 158, 8);

    const scanline = this.add.graphics();
    scanline.lineStyle(1, 0xffffff, 0.03);
    for (let y = 0; y < WORLD_HEIGHT; y += 3) {
      scanline.strokeLineShape(new Phaser.Geom.Line(0, y, WORLD_WIDTH, y));
    }

    this.add.text(28, 20, "CLAUDECRAFT COMMAND", {
      fontFamily: '"Bank Gothic", "Eurostile", "Orbitron", sans-serif',
      fontSize: "22px",
      color: "#dfefff"
    });

    this.add.text(30, 49, `SECTOR: ${this.runtimeConfig.race.toUpperCase()} OPENING`, {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "12px",
      color: "#8baecb"
    });

    this.mineralsText = this.add.text(430, 29, "Minerals: 0", {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "20px",
      color: "#7be7ff"
    });
    this.workersText = this.add.text(618, 29, "Workers: 0", {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "20px",
      color: "#94f0a0"
    });
    this.queueText = this.add.text(790, 29, "Queue: 0", {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "20px",
      color: "#ffd37a"
    });
    this.tickText = this.add.text(930, 29, "Tick: 0", {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "20px",
      color: "#f2f6fb"
    });

    this.sessionText = this.add.text(1085, 24, "IDLE", {
      fontFamily: '"Bank Gothic", "Eurostile", sans-serif',
      fontSize: "18px",
      color: "#fcbf49"
    });

    this.pathText = this.add.text(26, 86, "Session: -", {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "12px",
      color: "#a7b7cb"
    });

    this.add.text(36, 552, "MINIMAP", {
      fontFamily: '"Bank Gothic", "Eurostile", sans-serif',
      fontSize: "14px",
      color: "#9fb1c6"
    });
    this.add.text(312, 552, "UNITS", {
      fontFamily: '"Bank Gothic", "Eurostile", sans-serif',
      fontSize: "14px",
      color: "#9fb1c6"
    });
    this.add.text(826, 552, "PRODUCTION", {
      fontFamily: '"Bank Gothic", "Eurostile", sans-serif',
      fontSize: "14px",
      color: "#9fb1c6"
    });
    this.add.text(1052, 552, "EVENT LOG", {
      fontFamily: '"Bank Gothic", "Eurostile", sans-serif',
      fontSize: "14px",
      color: "#9fb1c6"
    });

    const commandGrid = this.add.graphics();
    commandGrid.lineStyle(1, 0x5d83a1, 0.7);
    const startX = 598;
    const startY = 552;
    const slotW = 56;
    const slotH = 42;
    const gap = 8;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const x = startX + col * (slotW + gap);
        const y = startY + row * (slotH + gap);
        commandGrid.fillStyle(0x0b1725, 0.95);
        commandGrid.fillRoundedRect(x, y, slotW, slotH, 6);
        commandGrid.strokeRoundedRect(x, y, slotW, slotH, 6);
      }
    }

    this.unitsListText = this.add.text(314, 576, "", {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "14px",
      color: "#dce6f3",
      lineSpacing: 6
    });

    this.queueListText = this.add.text(828, 576, "", {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "14px",
      color: "#dce6f3",
      lineSpacing: 6
    });

    this.eventsListText = this.add.text(1042, 576, "", {
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: "12px",
      color: "#dce6f3",
      lineSpacing: 4,
      wordWrap: { width: 206 }
    });
  }

  private drawWorld(): void {
    const world = this.add.graphics();
    world.fillStyle(0x0a1a2b, 0.96);
    world.fillRoundedRect(WORLD_VIEW_X, WORLD_VIEW_Y, WORLD_VIEW_W, WORLD_VIEW_H, 12);
    world.lineStyle(2, 0x3f6584, 0.8);
    world.strokeRoundedRect(WORLD_VIEW_X, WORLD_VIEW_Y, WORLD_VIEW_W, WORLD_VIEW_H, 12);
    world.lineStyle(1, 0x7ea4c2, 0.35);
    world.strokeRoundedRect(WORLD_VIEW_X + 4, WORLD_VIEW_Y + 4, WORLD_VIEW_W - 8, WORLD_VIEW_H - 8, 10);

    if (this.textures.exists("base")) {
      this.add.image(this.basePoint.x, this.basePoint.y, "base").setDisplaySize(128, 128);
    } else {
      world.fillStyle(0x5f71d0, 1);
      world.fillCircle(this.basePoint.x, this.basePoint.y, 48);
    }

    for (const point of this.minerals) {
      if (this.textures.exists("mineral")) {
        this.add.image(point.x, point.y, "mineral").setDisplaySize(78, 78);
      } else {
        world.fillStyle(0x2ea2c2, 1);
        world.fillTriangle(
          point.x - 18,
          point.y + 16,
          point.x - 10,
          point.y - 18,
          point.x + 20,
          point.y + 8
        );
      }
    }

    const mini = this.add.graphics();
    mini.fillStyle(0x0a1726, 1);
    mini.fillRoundedRect(34, 576, 244, 108, 8);
    mini.lineStyle(2, 0x3f6584, 0.85);
    mini.strokeRoundedRect(34, 576, 244, 108, 8);
    mini.fillStyle(0x0f2538, 1);
    mini.fillRoundedRect(MINIMAP_X, MINIMAP_Y, MINIMAP_W, MINIMAP_H, 6);

    this.minimapViewport = this.add.rectangle(MINIMAP_X + 50, MINIMAP_Y + 33, 76, 48);
    this.minimapViewport.setStrokeStyle(1, 0x9bc5e8, 0.85);
    this.minimapViewport.setFillStyle(0, 0);

    this.minimapBaseDot = this.add.circle(0, 0, 4, this.palette.accent, 0.95);
    this.syncMinimapBase();
  }

  private updateHud(envelope: GameStateEnvelope): void {
    const state = envelope.state;
    this.mineralsText?.setText(`Minerals: ${state.minerals}`);
    this.workersText?.setText(`Workers: ${state.workersMining}`);
    this.queueText?.setText(`Queue: ${state.productionQueue.length}`);
    this.tickText?.setText(`Tick: ${state.tick}`);

    const idleSecText = typeof envelope.idleSeconds === "number" ? ` ${envelope.idleSeconds}s` : "";
    this.sessionText?.setText(`${envelope.sessionStatus.toUpperCase()}${idleSecText}`);
    this.sessionText?.setColor(envelope.sessionStatus === "live" ? this.palette.live : "#fcbf49");

    this.pathText?.setText(`Session: ${envelope.boundGameStatePath}`);

    const unitEntries = Object.entries(state.units)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([name, count]) => `${name.padEnd(12)} ${String(count).padStart(3)}`);
    this.unitsListText?.setText(unitEntries.join("\n") || "No units");

    const queueLines = state.productionQueue
      .slice(0, 6)
      .map((item) => `${item.unitType} @${item.finishAtTick}`);
    this.queueListText?.setText(queueLines.join("\n") || "Queue empty");

    const eventLines = [...state.recentEvents]
      .reverse()
      .slice(0, 5)
      .map((item) => `${item.sourceEvent}: ${item.delta.note}`);
    this.eventsListText?.setText(eventLines.join("\n") || "No events yet");
  }

  private reconcileWorkers(workersMining: number): void {
    const desired = Math.min(Math.max(0, workersMining), MAX_VISUAL_WORKERS);
    while (this.model.workers.length < desired) {
      this.model.workers.push(this.createWorker(this.model.workers.length));
    }

    while (this.model.workers.length > desired) {
      const worker = this.model.workers.pop();
      worker?.sprite?.destroy();
      worker?.fallback?.destroy();
      worker?.carrying?.destroy();
      worker?.minimapDot?.destroy();
    }

    for (let i = 0; i < this.model.workers.length; i += 1) {
      this.model.workers[i].targetMineral = i % this.minerals.length;
    }
  }

  private createWorker(index: number): WorkerAgent {
    const offsetX = ((index % 5) - 2) * 14;
    const offsetY = (Math.floor(index / 5) % 3 - 1) * 14;
    const x = this.basePoint.x + offsetX;
    const y = this.basePoint.y + offsetY;

    const worker: WorkerAgent = {
      x,
      y,
      phase: "toMineral",
      targetMineral: index % this.minerals.length,
      dwell: 0,
      speed: 70 + (index % 5) * 8
    };

    if (this.textures.exists("worker")) {
      worker.sprite = this.add.image(x, y, "worker").setDisplaySize(30, 30);
    } else {
      worker.fallback = this.add.circle(x, y, 8, 0x77bc72);
    }

    worker.carrying = this.add.circle(x + 8, y - 8, 3, this.palette.alert, 0);
    worker.minimapDot = this.add.circle(0, 0, 2, 0x4fffa1, 0.9);
    this.syncWorkerVisual(worker);
    return worker;
  }

  private updateWorker(worker: WorkerAgent, dt: number): void {
    const target = this.minerals[worker.targetMineral];

    if (worker.phase === "toMineral") {
      if (this.moveWorker(worker, target.x, target.y, worker.speed * dt)) {
        worker.phase = "mining";
        worker.dwell = 0.5;
      }
      return;
    }

    if (worker.phase === "mining") {
      worker.dwell -= dt;
      if (worker.dwell <= 0) {
        worker.phase = "toBase";
      }
      return;
    }

    if (worker.phase === "toBase") {
      if (this.moveWorker(worker, this.basePoint.x + 22, this.basePoint.y + 16, worker.speed * dt)) {
        worker.phase = "deposit";
        worker.dwell = 0.3;
      }
      return;
    }

    worker.dwell -= dt;
    if (worker.dwell <= 0) {
      worker.phase = "toMineral";
    }
  }

  private moveWorker(worker: WorkerAgent, targetX: number, targetY: number, step: number): boolean {
    const dx = targetX - worker.x;
    const dy = targetY - worker.y;
    const length = Math.hypot(dx, dy);

    if (length <= step || length === 0) {
      worker.x = targetX;
      worker.y = targetY;
      return true;
    }

    worker.x += (dx / length) * step;
    worker.y += (dy / length) * step;
    return false;
  }

  private syncWorkerVisual(worker: WorkerAgent): void {
    const carryingVisible = worker.phase === "toBase" || worker.phase === "deposit";
    worker.sprite?.setPosition(worker.x, worker.y);
    worker.fallback?.setPosition(worker.x, worker.y);
    worker.carrying?.setPosition(worker.x + 8, worker.y - 8).setAlpha(carryingVisible ? 1 : 0);

    const miniX = MINIMAP_X + ((worker.x - WORLD_VIEW_X) / WORLD_VIEW_W) * MINIMAP_W;
    const miniY = MINIMAP_Y + ((worker.y - WORLD_VIEW_Y) / WORLD_VIEW_H) * MINIMAP_H;
    worker.minimapDot?.setPosition(miniX, miniY);
  }

  private syncMinimapBase(): void {
    const baseMiniX = MINIMAP_X + ((this.basePoint.x - WORLD_VIEW_X) / WORLD_VIEW_W) * MINIMAP_W;
    const baseMiniY = MINIMAP_Y + ((this.basePoint.y - WORLD_VIEW_Y) / WORLD_VIEW_H) * MINIMAP_H;
    this.minimapBaseDot?.setPosition(baseMiniX, baseMiniY);
  }
}

function paletteForRace(race: RuntimeConfig["race"]): UiPalette {
  if (race === "protoss") {
    return { accent: 0x65a5ff, alert: 0x9be3ff, live: "#7fbeff" };
  }
  if (race === "zerg") {
    return { accent: 0x7bcf74, alert: 0x8bf6a4, live: "#8ceb90" };
  }
  return { accent: 0x5bb0ff, alert: 0x64e2ff, live: "#57d88a" };
}

async function bootstrap(): Promise<void> {
  const runtimeConfig = (await fetch("/runtime-config.json").then((res) => res.json())) as RuntimeConfig;

  const envelopeStore = new EnvelopeStore();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    parent: "app",
    backgroundColor: "#081320",
    scene: [new RtsScene(envelopeStore, runtimeConfig)]
  });

  const initial = (await fetch(`${runtimeConfig.apiBase}/state`).then((res) => res.json())) as GameStateEnvelope;
  envelopeStore.set(initial);

  const stream = new EventSource(`${runtimeConfig.apiBase}/events/stream`);
  stream.onmessage = (event) => {
    try {
      envelopeStore.set(JSON.parse(event.data) as GameStateEnvelope);
    } catch {
      // ignore malformed payload
    }
  };

  window.addEventListener("beforeunload", () => {
    stream.close();
    game.destroy(true);
  });
}

void bootstrap();
