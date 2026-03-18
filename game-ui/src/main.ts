import Phaser from "phaser";
import type { GameStateEnvelope, RuntimeConfig } from "./types";

const GAME_WIDTH = 1024;
const GAME_HEIGHT = 768;
const TOP_BAR_HEIGHT = 56;
const WORLD_X = 0;
const WORLD_Y = TOP_BAR_HEIGHT;
const WORLD_WIDTH = GAME_WIDTH;
const WORLD_HEIGHT = 492;
const HUD_Y = WORLD_Y + WORLD_HEIGHT;
const HUD_HEIGHT = GAME_HEIGHT - HUD_Y;
const MAX_VISUAL_WORKERS = 200;

const MAP_MIN_X = 60;
const MAP_MAX_X = 940;
const MAP_MIN_Y = 90;
const MAP_MAX_Y = 460;

const MINIMAP_X = 22;
const MINIMAP_Y = HUD_Y + 30;
const MINIMAP_W = 188;
const MINIMAP_H = 132;

const UNIT_PANEL_X = 236;
const UNIT_PANEL_Y = HUD_Y + 24;
const UNIT_PANEL_W = 258;
const UNIT_PANEL_H = 164;

const COMMAND_PANEL_X = 516;
const COMMAND_PANEL_Y = HUD_Y + 24;
const COMMAND_PANEL_W = 220;
const COMMAND_PANEL_H = 164;

const EVENT_PANEL_X = 760;
const EVENT_PANEL_Y = HUD_Y + 24;
const EVENT_PANEL_W = 240;
const EVENT_PANEL_H = 164;

const STARCRAFT_HUD_LAYOUT = {
  unit: {
    portraitX: UNIT_PANEL_X + 68,
    portraitY: UNIT_PANEL_Y + 74,
    portraitScale: 1.8,
    statsX: UNIT_PANEL_X + 132,
    statsY: UNIT_PANEL_Y + 58
  },
  command: {
    startX: EVENT_PANEL_X + 14,
    startY: EVENT_PANEL_Y + 24,
    slotW: 68,
    slotH: 47,
    gapX: 17,
    gapY: 10,
    iconSize: 34,
    queueX: COMMAND_PANEL_X + 18,
    queueY: COMMAND_PANEL_Y + 136
  },
  event: {
    textX: COMMAND_PANEL_X + 18,
    textY: COMMAND_PANEL_Y + 14,
    wrapW: COMMAND_PANEL_W - 30
  }
} as const;

type Phase = "toMineral" | "mining" | "toBase" | "deposit";

type ThemeName = RuntimeConfig["uiTheme"];

interface WorkerAgent {
  sprite?: Phaser.GameObjects.Image;
  fallback?: Phaser.GameObjects.Arc;
  shadow?: Phaser.GameObjects.Ellipse;
  ring?: Phaser.GameObjects.Ellipse;
  thruster?: Phaser.GameObjects.Arc;
  carrying?: Phaser.GameObjects.Image | Phaser.GameObjects.Arc;
  minimapDot?: Phaser.GameObjects.Arc;
  lane: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: Phase;
  targetMineral: number;
  dwell: number;
  speed: number;
  facingRad: number;
  targetFacingRad: number;
}

interface RenderModel {
  envelope?: GameStateEnvelope;
  workers: WorkerAgent[];
}

interface ThemeTextures {
  uiTop: string;
  uiBottom: string;
  portrait: string;
  accentHex: string;
  textHex: string;
  minimapDot: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

interface MineralVisual {
  glow: Phaser.GameObjects.Ellipse;
  phase: number;
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
  private readonly basePoint = new Phaser.Math.Vector2(530, 300);
  private readonly minerals: Phaser.Math.Vector2[] = [
    new Phaser.Math.Vector2(172, 150),
    new Phaser.Math.Vector2(160, 195),
    new Phaser.Math.Vector2(154, 240),
    new Phaser.Math.Vector2(154, 285),
    new Phaser.Math.Vector2(160, 330),
    new Phaser.Math.Vector2(170, 375),
    new Phaser.Math.Vector2(182, 420),
    new Phaser.Math.Vector2(198, 458)
  ];

  private readonly envelopeStore: EnvelopeStore;
  private readonly runtimeConfig: RuntimeConfig;
  private readonly theme: ThemeTextures;

  private mineralsText?: Phaser.GameObjects.Text;
  private gasText?: Phaser.GameObjects.Text;
  private supplyText?: Phaser.GameObjects.Text;
  private queueText?: Phaser.GameObjects.Text;
  private tickText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  private unitText?: Phaser.GameObjects.Text;
  private queueListText?: Phaser.GameObjects.Text;
  private eventText?: Phaser.GameObjects.Text;
  private portraitBg?: Phaser.GameObjects.Rectangle;
  private portraitImage?: Phaser.GameObjects.Image;
  private minimapBase?: Phaser.GameObjects.Arc;
  private minimapSweep?: Phaser.GameObjects.Rectangle;
  private basePulseRing?: Phaser.GameObjects.Ellipse;
  private baseBloom?: Phaser.GameObjects.Ellipse;
  private readonly mineralVisuals: MineralVisual[] = [];

  constructor(envelopeStore: EnvelopeStore, runtimeConfig: RuntimeConfig) {
    super("rts-scene");
    this.envelopeStore = envelopeStore;
    this.runtimeConfig = runtimeConfig;
    this.theme = themeTextures(runtimeConfig.uiTheme);
  }

  private isStarcraftLocalPack(): boolean {
    return this.runtimeConfig.assetPack === "starcraft-local";
  }

  preload(): void {
    this.load.spritesheet("scThingyTop", "/starcraft/thingy.png", {
      frameWidth: 14,
      frameHeight: 14
    });

    const keys = [
      "worker",
      "base",
      "mineralPatch",
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
      "commandHold",
      "unitLight",
      "unitHeavy",
      "queue"
    ] as const;

    for (const key of keys) {
      this.load.image(key, `/game-assets/${key}`);
    }
  }

  create(): void {
    this.drawBackgroundAndWorld();
    this.drawHudShell();
    this.drawPanels();

    this.envelopeStore.subscribe((envelope) => {
      this.model.envelope = envelope;
      this.reconcileWorkers(envelope.state.workersMining);
      this.updateHud(envelope);
    });
  }

  update(time: number, delta: number): void {
    const dt = Math.max(0.001, Math.min(0.05, delta / 1000));
    this.animateAmbient(time);
    this.advanceWorkers(dt);
    this.applyWorkerSeparation(dt);

    for (const worker of this.model.workers) {
      this.syncWorkerVisual(worker);
    }
  }

  private drawBackgroundAndWorld(): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x0a1120, 0x0a1120, 0x05070d, 0x05070d, 1);
    sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    if (this.textures.exists("terrainTile")) {
      if (starcraftLocal) {
        this.add
          .image(WORLD_X + WORLD_WIDTH / 2, WORLD_Y + WORLD_HEIGHT / 2, "terrainTile")
          .setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT)
          .setAlpha(0.98);
      } else {
        this.add
          .tileSprite(
            WORLD_X + WORLD_WIDTH / 2,
            WORLD_Y + WORLD_HEIGHT / 2,
            WORLD_WIDTH,
            WORLD_HEIGHT,
            "terrainTile"
          )
          .setAlpha(0.96);
      }
    } else {
      this.add.rectangle(WORLD_WIDTH / 2, WORLD_Y + WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x2a2d33, 1);
    }

    if (starcraftLocal) {
      const grade = this.add.graphics();
      grade.fillStyle(0x05141e, 0.2);
      grade.fillRect(WORLD_X, WORLD_Y, WORLD_WIDTH, WORLD_HEIGHT);
      grade.fillStyle(0x2d3b1f, 0.1);
      grade.fillRect(WORLD_X, WORLD_Y + WORLD_HEIGHT * 0.58, WORLD_WIDTH, WORLD_HEIGHT * 0.42);
    }

    if (!starcraftLocal) {
      const worldPerspective = this.add.graphics();
      worldPerspective.fillStyle(0x000000, 0.16);
      worldPerspective.fillPoints(
        [
          new Phaser.Geom.Point(84, WORLD_Y + 10),
          new Phaser.Geom.Point(GAME_WIDTH - 84, WORLD_Y + 10),
          new Phaser.Geom.Point(GAME_WIDTH - 4, WORLD_Y + WORLD_HEIGHT - 6),
          new Phaser.Geom.Point(4, WORLD_Y + WORLD_HEIGHT - 6)
        ],
        true
      );
      this.drawPerspectiveGrid();
    }

    if (!starcraftLocal && this.textures.exists("terrainCreep")) {
      const baseProjected = this.projectMapToScreen(this.basePoint.x, this.basePoint.y);
      this.add
        .image(baseProjected.x + 6, baseProjected.y + 30, "terrainCreep")
        .setDisplaySize(
          (starcraftLocal ? 560 : 620) * baseProjected.scale,
          (starcraftLocal ? 280 : 320) * baseProjected.scale
        )
        .setAlpha(starcraftLocal ? 0.42 : 0.58)
        .setDepth(120);
    }

    this.drawMineralLine();
    this.drawBaseAndDoodads();
    this.drawMinimapBackdrops();
    if (starcraftLocal) {
      this.drawWorldFeather();
    }

    if (!starcraftLocal) {
      const worldEdge = this.add.graphics();
      worldEdge.lineStyle(2, 0x1f2533, 0.85);
      worldEdge.strokeRect(WORLD_X + 2, WORLD_Y + 2, WORLD_WIDTH - 4, WORLD_HEIGHT - 4);
    }
  }

  private drawWorldFeather(): void {
    const g = this.add.graphics();
    const layers = [0.1, 0.07, 0.05];
    const thickness = [28, 20, 12];
    for (let i = 0; i < layers.length; i += 1) {
      const alpha = layers[i];
      const t = thickness[i];
      g.fillStyle(0x000000, alpha);
      g.fillRect(WORLD_X, WORLD_Y, WORLD_WIDTH, t);
      g.fillRect(WORLD_X, WORLD_Y + WORLD_HEIGHT - t, WORLD_WIDTH, t);
      g.fillRect(WORLD_X, WORLD_Y, t, WORLD_HEIGHT);
      g.fillRect(WORLD_X + WORLD_WIDTH - t, WORLD_Y, t, WORLD_HEIGHT);
    }
    g.setDepth(980);
  }

  private drawPerspectiveGrid(): void {
    const grid = this.add.graphics();
    const vanishingX = GAME_WIDTH / 2;
    const horizonY = WORLD_Y + 44;
    const bottomY = WORLD_Y + WORLD_HEIGHT - 2;

    grid.lineStyle(1, 0x95a2c8, 0.08);
    for (let i = 0; i <= 14; i += 1) {
      const x = Phaser.Math.Linear(40, GAME_WIDTH - 40, i / 14);
      grid.strokeLineShape(new Phaser.Geom.Line(x, bottomY, vanishingX + (x - vanishingX) * 0.12, horizonY));
    }

    grid.lineStyle(1, 0xcfd9f7, 0.07);
    for (let i = 0; i <= 10; i += 1) {
      const depth = i / 10;
      const y = Phaser.Math.Linear(horizonY, bottomY, depth * depth);
      const inset = Phaser.Math.Linear(82, 8, depth);
      grid.strokeLineShape(new Phaser.Geom.Line(inset, y, GAME_WIDTH - inset, y));
    }

    const vignet = this.add.graphics();
    vignet.fillStyle(0x000000, 0.12);
    vignet.fillRect(0, WORLD_Y, GAME_WIDTH, 120);
    vignet.fillStyle(0x000000, 0.16);
    vignet.fillRect(0, WORLD_Y + WORLD_HEIGHT - 90, GAME_WIDTH, 90);
  }

  private drawMineralLine(): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    const mineralSize = starcraftLocal ? 108 : 72;
    const shadowW = starcraftLocal ? 52 : 34;
    const shadowH = starcraftLocal ? 22 : 14;
    this.mineralVisuals.length = 0;

    for (let i = 0; i < this.minerals.length; i += 1) {
      const node = this.minerals[i];
      const p = this.projectMapToScreen(node.x, node.y);
      this.add
        .ellipse(p.x + 8, p.y + 14, shadowW * p.scale, shadowH * p.scale, 0x000000, 0.34)
        .setDepth(p.depth - 1);

      if (this.textures.exists("mineralPatch")) {
        const sizeVariance = 0.94 + (i % 3) * 0.04;
        const angleVariance = (i % 4) * 4 - 6;
        const mineral = this.add
          .image(p.x, p.y, "mineralPatch")
          .setOrigin(0.5, 0.72)
          .setDisplaySize(mineralSize * p.scale * sizeVariance, mineralSize * p.scale * sizeVariance)
          .setAngle(angleVariance)
          .setDepth(p.depth + 8);
        if (starcraftLocal) {
          mineral.setAlpha(0.96);
          const glow = this.add
            .ellipse(p.x + 4, p.y + 6, 40 * p.scale, 14 * p.scale, 0x8ed7ff, 0.08)
            .setDepth(p.depth + 7);
          glow.setBlendMode(Phaser.BlendModes.ADD);
          this.mineralVisuals.push({ glow, phase: i * 0.9 });
        }
      } else {
        this.add
          .triangle(p.x, p.y, -18 * p.scale, 18 * p.scale, 0, -18 * p.scale, 20 * p.scale, 16 * p.scale, 0x73d9ff, 0.9)
          .setDepth(p.depth + 8);
      }
    }
  }

  private drawBaseAndDoodads(): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    const p = this.projectMapToScreen(this.basePoint.x, this.basePoint.y);
    const baseSize = starcraftLocal ? 148 : 170;
    const baseShadowW = starcraftLocal ? 176 : 138;
    const baseShadowH = starcraftLocal ? 68 : 52;
    if (starcraftLocal) {
      this.add.ellipse(p.x + 6, p.y + 32, 220 * p.scale, 86 * p.scale, 0x1c1b19, 0.28).setDepth(p.depth - 3);
      this.add.ellipse(p.x + 8, p.y + 22, 240 * p.scale, 96 * p.scale, 0x0b1416, 0.2).setDepth(p.depth - 4);
      this.basePulseRing = this.add
        .ellipse(p.x + 8, p.y + 26, 128 * p.scale, 46 * p.scale, 0x67d188, 0.16)
        .setStrokeStyle(1, 0x78dc96, 0.52)
        .setDepth(p.depth - 1);
      this.baseBloom = this.add
        .ellipse(p.x + 10, p.y + 24, 152 * p.scale, 64 * p.scale, 0x68c8ff, 0.06)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(p.depth - 1);
    }
    this.add
      .ellipse(p.x + 10, p.y + 26, baseShadowW * p.scale, baseShadowH * p.scale, 0x000000, 0.4)
      .setDepth(p.depth - 2);

    if (this.textures.exists("base")) {
      this.add
        .image(p.x, p.y - 2, "base")
        .setOrigin(0.5, 0.74)
        .setDisplaySize(baseSize * p.scale, baseSize * p.scale)
        .setDepth(p.depth + 10);
    } else {
      this.add.circle(p.x, p.y, 64 * p.scale, 0x5a2b2f, 0.95).setDepth(p.depth + 10);
    }

    if (!starcraftLocal) {
      const doodad = this.add.graphics();
      doodad.fillStyle(0x40342b, 0.84);
      doodad.fillRoundedRect(422, 92, 78, 26, 6);
      doodad.fillRoundedRect(588, 90, 88, 30, 6);
      doodad.fillStyle(0x6b5a49, 0.84);
      doodad.fillRoundedRect(438, 88, 42, 18, 5);
      doodad.fillRoundedRect(608, 84, 44, 20, 5);
      doodad.setDepth(30);
    }
  }

  private drawHudShell(): void {
    const starcraftLocal = this.isStarcraftLocalPack();

    if (this.textures.exists(this.theme.uiTop)) {
      this.add.image(GAME_WIDTH / 2, TOP_BAR_HEIGHT / 2, this.theme.uiTop).setDisplaySize(GAME_WIDTH, TOP_BAR_HEIGHT);
    } else {
      this.add.rectangle(GAME_WIDTH / 2, TOP_BAR_HEIGHT / 2, GAME_WIDTH, TOP_BAR_HEIGHT, 0x15202b, 1);
    }

    if (this.textures.exists(this.theme.uiBottom)) {
      this.add
        .image(GAME_WIDTH / 2, HUD_Y + HUD_HEIGHT / 2, this.theme.uiBottom)
        .setDisplaySize(GAME_WIDTH, HUD_HEIGHT + 2);
    } else {
      this.add.rectangle(GAME_WIDTH / 2, HUD_Y + HUD_HEIGHT / 2, GAME_WIDTH, HUD_HEIGHT + 2, 0x1b1a24, 1);
    }

    if (!starcraftLocal) {
      const topShade = this.add.graphics();
      topShade.fillGradientStyle(0x000000, 0x000000, 0x091019, 0x091019, 0.35);
      topShade.fillRect(0, 0, GAME_WIDTH, TOP_BAR_HEIGHT);
    }

    this.drawTopBar();
  }

  private drawTopBar(): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    if (!starcraftLocal) {
      const title = this.add.text(20, 18, "CLAUDECRAFT BRIEFING", {
        fontFamily: '"Eurostile", "Rajdhani", sans-serif',
        fontSize: "18px",
        color: this.theme.textHex
      });
      title.setShadow(1, 1, "#000000", 4, true, true);
    }

    this.statusText = this.add.text(starcraftLocal ? 10 : 20, starcraftLocal ? 4 : 2, "LIVE", {
      fontFamily: '"Rajdhani", sans-serif',
      fontSize: starcraftLocal ? "14px" : "12px",
      color: this.theme.accentHex
    });
    this.statusText.setShadow(0, 0, "#000000", 5, false, true);

    if (starcraftLocal) {
      const iconScale = 1.45;
      const iconY = 18;
      const metricY = 7;
      const mineralIconX = 698;
      const gasIconX = 794;
      const supplyIconX = 904;
      const hasThingy = this.textures.exists("scThingyTop");

      if (hasThingy) {
        this.add.image(mineralIconX, iconY, "scThingyTop", 0).setScale(iconScale);
        this.add.image(gasIconX, iconY, "scThingyTop", 2).setScale(iconScale);
        this.add.image(supplyIconX, iconY, "scThingyTop", 5).setScale(iconScale);
      } else {
        if (this.textures.exists("iconMinerals")) {
          this.add.image(mineralIconX, iconY, "iconMinerals").setDisplaySize(20, 20);
        }
        if (this.textures.exists("iconSupply")) {
          this.add.image(supplyIconX, iconY, "iconSupply").setDisplaySize(20, 20);
        }
      }

      const hudText = {
        fontFamily: '"Verdana", "Rajdhani", sans-serif',
        fontSize: "16px",
        color: "#2eff45",
        fontStyle: "bold"
      } as const;

      this.mineralsText = this.add.text(mineralIconX + 16, metricY, "0", hudText);
      this.gasText = this.add.text(gasIconX + 16, metricY, "0", hudText);
      this.supplyText = this.add.text(supplyIconX + 16, metricY, "0/0", hudText);
      this.mineralsText.setShadow(0, 0, "#0a3a16", 4, false, true);
      this.gasText.setShadow(0, 0, "#0a3a16", 4, false, true);
      this.supplyText.setShadow(0, 0, "#0a3a16", 4, false, true);
    } else {
      const mineralIconX = 706;
      const supplyIconX = 844;
      const iconY = 28;
      const metricY = 16;

      if (this.textures.exists("iconMinerals")) {
        this.add.image(mineralIconX, iconY, "iconMinerals").setDisplaySize(24, 24);
      }
      if (this.textures.exists("iconSupply")) {
        this.add.image(supplyIconX, iconY, "iconSupply").setDisplaySize(24, 24);
      }

      this.mineralsText = this.add.text(mineralIconX + 20, metricY, "0", {
        fontFamily: '"Rajdhani", sans-serif',
        fontSize: "24px",
        color: "#8ce8ff"
      });
      this.mineralsText.setShadow(0, 0, "#032133", 6, false, true);

      this.supplyText = this.add.text(supplyIconX + 20, metricY, "0/0", {
        fontFamily: '"Rajdhani", sans-serif',
        fontSize: "24px",
        color: "#c5f8a5"
      });
      this.supplyText.setShadow(0, 0, "#102909", 6, false, true);
    }

    if (!starcraftLocal) {
      this.queueText = this.add.text(930, 10, "Q:0", {
        fontFamily: '"Rajdhani", sans-serif',
        fontSize: "14px",
        color: "#f7ddb6"
      });

      this.tickText = this.add.text(930, 30, "T:0", {
        fontFamily: '"Rajdhani", sans-serif',
        fontSize: "14px",
        color: "#f1f5fa"
      });
    }
  }

  private drawPanels(): void {
    this.drawMinimapPanel();
    this.drawUnitPanel();
    this.drawCommandPanel();
    this.drawEventPanel();
  }

  private drawMinimapPanel(): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    if (!starcraftLocal) {
      const panel = this.add.graphics();
      panel.fillStyle(0x0a0d12, 0.85);
      panel.fillRoundedRect(MINIMAP_X - 8, MINIMAP_Y - 8, MINIMAP_W + 16, MINIMAP_H + 16, 8);
      panel.lineStyle(1, 0x3f4758, 0.8);
      panel.strokeRoundedRect(MINIMAP_X - 8, MINIMAP_Y - 8, MINIMAP_W + 16, MINIMAP_H + 16, 8);
    }

    this.add.rectangle(
      MINIMAP_X + MINIMAP_W / 2,
      MINIMAP_Y + MINIMAP_H / 2,
      MINIMAP_W,
      MINIMAP_H,
      0x0f131a,
      starcraftLocal ? 0.2 : 0.98
    );

    if (starcraftLocal) {
      this.minimapSweep = this.add
        .rectangle(MINIMAP_X + MINIMAP_W / 2, MINIMAP_Y + 10, MINIMAP_W - 14, 6, 0x66d9ff, 0.2)
        .setBlendMode(Phaser.BlendModes.ADD);
    }

    if (this.textures.exists("minimapFrame")) {
      this.add
        .image(MINIMAP_X + MINIMAP_W / 2, MINIMAP_Y + MINIMAP_H / 2, "minimapFrame")
        .setDisplaySize(MINIMAP_W + 8, MINIMAP_H + 8);
    }

    this.minimapBase = this.add.circle(
      0,
      0,
      4,
      Phaser.Display.Color.HexStringToColor(this.theme.accentHex).color,
      0.9
    );
    this.syncMinimapBase();
  }

  private drawUnitPanel(): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    if (!starcraftLocal) {
      const panel = this.add.graphics();
      panel.fillStyle(0x090c12, 0.78);
      panel.fillRoundedRect(UNIT_PANEL_X, UNIT_PANEL_Y, UNIT_PANEL_W, UNIT_PANEL_H, 8);
      panel.lineStyle(1, 0x4b5568, 0.82);
      panel.strokeRoundedRect(UNIT_PANEL_X, UNIT_PANEL_Y, UNIT_PANEL_W, UNIT_PANEL_H, 8);
      this.portraitBg = this.add.rectangle(UNIT_PANEL_X + 56, UNIT_PANEL_Y + 56, 96, 96, 0x090f15, 0.95);
    }

    const portraitKey = this.theme.portrait;
    if (this.textures.exists(portraitKey)) {
      const portraitX = starcraftLocal ? STARCRAFT_HUD_LAYOUT.unit.portraitX : UNIT_PANEL_X + 56;
      const portraitY = starcraftLocal ? STARCRAFT_HUD_LAYOUT.unit.portraitY : UNIT_PANEL_Y + 56;
      const portrait = this.add.image(portraitX, portraitY, portraitKey);
      if (starcraftLocal) {
        portrait.setScale(STARCRAFT_HUD_LAYOUT.unit.portraitScale);
      } else {
        portrait.setDisplaySize(88, 88);
      }
      this.portraitImage = portrait;
    }

    const infoX = starcraftLocal ? STARCRAFT_HUD_LAYOUT.unit.statsX : UNIT_PANEL_X + 108;
    const infoY = starcraftLocal ? STARCRAFT_HUD_LAYOUT.unit.statsY : UNIT_PANEL_Y + 34;
    if (!starcraftLocal) {
      this.add.text(infoX, UNIT_PANEL_Y + 10, `${this.runtimeConfig.uiTheme.toUpperCase()} WORKER`, {
        fontFamily: '"Rajdhani", sans-serif',
        fontSize: "16px",
        color: "#dce7f7"
      });
    }

    this.unitText = this.add.text(infoX, infoY, "", {
      fontFamily: '"Rajdhani", monospace',
      fontSize: starcraftLocal ? "16px" : "13px",
      color: starcraftLocal ? "#eef5ff" : "#c6cfda",
      lineSpacing: starcraftLocal ? 8 : 5
    });
    if (starcraftLocal) {
      this.unitText.setWordWrapWidth(118);
      this.unitText.setShadow(0, 0, "#000000", 6, false, true);
    }
  }

  private drawCommandPanel(): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    const panel = this.add.graphics();
    if (!starcraftLocal) {
      panel.fillStyle(0x090c12, 0.78);
      panel.fillRoundedRect(COMMAND_PANEL_X, COMMAND_PANEL_Y, COMMAND_PANEL_W, COMMAND_PANEL_H, 8);
      panel.lineStyle(1, 0x4b5568, 0.82);
      panel.strokeRoundedRect(COMMAND_PANEL_X, COMMAND_PANEL_Y, COMMAND_PANEL_W, COMMAND_PANEL_H, 8);
    }

    const slotW = starcraftLocal ? STARCRAFT_HUD_LAYOUT.command.slotW : 62;
    const slotH = starcraftLocal ? STARCRAFT_HUD_LAYOUT.command.slotH : 44;
    const gapX = starcraftLocal ? STARCRAFT_HUD_LAYOUT.command.gapX : 8;
    const gapY = starcraftLocal ? STARCRAFT_HUD_LAYOUT.command.gapY : 8;
    const startX = starcraftLocal ? STARCRAFT_HUD_LAYOUT.command.startX : COMMAND_PANEL_X + 10;
    const startY = starcraftLocal ? STARCRAFT_HUD_LAYOUT.command.startY : COMMAND_PANEL_Y + 12;

    const icons = starcraftLocal
      ? ([
          "commandMove",
          "commandStop",
          "commandHold",
          "unitLight",
          "unitHeavy",
          "queue",
          null,
          null,
          null
        ] as const)
      : ([
          "commandMove",
          "commandStop",
          "commandHold",
          "unitLight",
          "unitHeavy",
          "queue",
          "commandMove",
          "commandStop",
          "commandHold"
        ] as const);

    const rowCount = 3;
    for (let row = 0; row < rowCount; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const x = startX + col * (slotW + gapX);
        const y = startY + row * (slotH + gapY);

        if (starcraftLocal) {
          // texture already has visible grid cells – no overlay needed
        } else {
          panel.fillStyle(0x0f141d, 0.95);
          panel.fillRoundedRect(x, y, slotW, slotH, 6);
          panel.lineStyle(1, 0x5b6374, 0.75);
          panel.strokeRoundedRect(x, y, slotW, slotH, 6);
        }

        const icon = icons[row * 3 + col];
        if (icon && this.textures.exists(icon)) {
          type IconKey = Exclude<(typeof icons)[number], null>;
          const normalizedIcon = icon as IconKey;
          const starcraftSizeMap: Partial<Record<IconKey, number>> = {
            commandMove: 20,
            commandStop: 20,
            commandHold: 21,
            unitLight: 20,
            unitHeavy: 18,
            queue: 21
          };
          const starcraftOffsetMap: Partial<Record<IconKey, { dx: number; dy: number }>> = {
            commandMove: { dx: -1, dy: 0 },
            commandStop: { dx: 0, dy: 0 },
            commandHold: { dx: 0, dy: -1 },
            unitLight: { dx: -1, dy: 1 },
            unitHeavy: { dx: 0, dy: 0 },
            queue: { dx: 0, dy: 0 }
          };
          const iconSize = starcraftLocal
            ? (starcraftSizeMap[normalizedIcon] ?? STARCRAFT_HUD_LAYOUT.command.iconSize)
            : 28;
          const iconOffset = starcraftLocal
            ? (starcraftOffsetMap[normalizedIcon] ?? { dx: 0, dy: 0 })
            : { dx: 0, dy: 0 };
          this.add
            .image(x + slotW / 2 + iconOffset.dx, y + slotH / 2 + iconOffset.dy, icon)
            .setDisplaySize(iconSize, iconSize)
            .setAlpha(starcraftLocal ? 0.94 : 0.9);
        }
      }
    }

    this.queueListText = this.add.text(
      starcraftLocal ? STARCRAFT_HUD_LAYOUT.command.queueX : COMMAND_PANEL_X + 12,
      starcraftLocal ? STARCRAFT_HUD_LAYOUT.command.queueY : COMMAND_PANEL_Y + 146,
      "",
      {
        fontFamily: '"Rajdhani", monospace',
        fontSize: starcraftLocal ? "13px" : "12px",
        color: starcraftLocal ? "#f4f7ff" : "#d1d9e5",
        align: "left"
      }
    );
    if (starcraftLocal) {
      this.queueListText.setOrigin(0, 0);
      this.queueListText.setShadow(0, 0, "#000000", 6, false, true);
    }
  }

  private drawEventPanel(): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    if (!starcraftLocal) {
      const panel = this.add.graphics();
      panel.fillStyle(0x090c12, 0.78);
      panel.fillRoundedRect(EVENT_PANEL_X, EVENT_PANEL_Y, EVENT_PANEL_W, EVENT_PANEL_H, 8);
      panel.lineStyle(1, 0x4b5568, 0.82);
      panel.strokeRoundedRect(EVENT_PANEL_X, EVENT_PANEL_Y, EVENT_PANEL_W, EVENT_PANEL_H, 8);
    }

    this.eventText = this.add.text(
      starcraftLocal ? STARCRAFT_HUD_LAYOUT.event.textX : EVENT_PANEL_X + 10,
      starcraftLocal ? STARCRAFT_HUD_LAYOUT.event.textY : EVENT_PANEL_Y + 10,
      "",
      {
        fontFamily: '"Rajdhani", monospace',
        fontSize: starcraftLocal ? "12px" : "12px",
        color: "#d6deeb",
        wordWrap: { width: starcraftLocal ? STARCRAFT_HUD_LAYOUT.event.wrapW : EVENT_PANEL_W - 18 },
        lineSpacing: 4
      }
    );
    if (starcraftLocal) {
      this.eventText.setShadow(0, 0, "#000000", 6, false, true);
    }
  }

  private updateHud(envelope: GameStateEnvelope): void {
    const state = envelope.state;
    this.mineralsText?.setText(String(state.minerals));
    this.gasText?.setText(String(state.gas));
    this.supplyText?.setText(`${state.workersMining}/${state.workers}`);
    this.queueText?.setText(`Q:${state.productionQueue.length}`);
    this.tickText?.setText(`T:${state.tick}`);

    const idleSec = typeof envelope.idleSeconds === "number" ? ` ${envelope.idleSeconds}s` : "";
    this.statusText?.setText(`${envelope.sessionStatus.toUpperCase()}${idleSec}`);

    const unitEntries = Object.entries(state.units)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name, count]) => `${name.padEnd(10)} ${String(count).padStart(2)}`);

    if (this.isStarcraftLocalPack()) {
      this.unitText?.setText([
        `Workers: ${state.workersMining}`,
        `SCV: ${state.units.SCV ?? state.workersMining}`
      ].join("\n"));
    } else {
      this.unitText?.setText([
        `Workers: ${state.workersMining}`,
        `Queue: ${state.productionQueue.length}`,
        unitEntries.join("\n") || "No units"
      ].join("\n\n"));
    }

    if (this.isStarcraftLocalPack()) {
      this.queueListText?.setText(this.formatQueueSummary(state.productionQueue));
    } else {
      const queueLines = state.productionQueue.slice(0, 2).map((item) => `${item.unitType}@${item.finishAtTick}`);
      this.queueListText?.setText(queueLines.length > 0 ? queueLines.join(" ") : "Queue empty");
    }

    const events = this.summarizeEvents(state.recentEvents);
    this.eventText?.setText(events.join("\n") || "No events yet");
  }

  private formatQueueSummary(queue: GameStateEnvelope["state"]["productionQueue"]): string {
    if (queue.length === 0) {
      return "Queue: empty";
    }

    const first = queue[0];
    const count = queue.filter((item) => item.unitType === first.unitType).length;
    return `Queue: ${first.unitType} x${count}`;
  }

  private summarizeEvents(recentEvents: GameStateEnvelope["state"]["recentEvents"]): string[] {
    if (!this.isStarcraftLocalPack()) {
      return [...recentEvents]
        .reverse()
        .slice(0, 6)
        .map((entry) => `${entry.sourceEvent}: ${entry.delta.note}`);
    }

    const clipped = [...recentEvents].reverse().slice(0, 3);
    return clipped.map((entry) => {
      const text = `${entry.sourceEvent}: ${entry.delta.note}`;
      return text.length > 36 ? `${text.slice(0, 33)}...` : text;
    });
  }

  private reconcileWorkers(workerCount: number): void {
    const desired = Math.min(Math.max(0, workerCount), MAX_VISUAL_WORKERS);

    while (this.model.workers.length < desired) {
      this.model.workers.push(this.createWorker(this.model.workers.length));
    }

    while (this.model.workers.length > desired) {
      const worker = this.model.workers.pop();
      worker?.shadow?.destroy();
      worker?.ring?.destroy();
      worker?.thruster?.destroy();
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
    const offsetX = ((index % 5) - 2) * 10;
    const offsetY = (Math.floor(index / 5) % 4 - 1) * 10;
    const x = this.basePoint.x + offsetX;
    const y = this.basePoint.y + offsetY;

    const worker: WorkerAgent = {
      lane: index,
      x,
      y,
      vx: 0,
      vy: 0,
      phase: "toMineral",
      targetMineral: index % this.minerals.length,
      dwell: 0,
      speed: 65 + (index % 6) * 6,
      facingRad: Math.PI / 2,
      targetFacingRad: Math.PI / 2
    };

    worker.shadow = this.add.ellipse(0, 0, 14, 7, 0x000000, 0.34);
    worker.ring = this.add.ellipse(0, 0, 16, 8, 0x67d188, 0).setStrokeStyle(1, 0x7de7a1, 0);
    worker.thruster = this.add.circle(0, 0, 3, 0x8be7ff, 0).setBlendMode(Phaser.BlendModes.ADD);

    if (this.textures.exists("worker")) {
      worker.sprite = this.add.image(x, y, "worker").setOrigin(0.5, 0.78);
    } else {
      worker.fallback = this.add.circle(x, y, 6, 0xaad39f, 0.95);
    }

    if (this.textures.exists("iconMinerals")) {
      worker.carrying = this.add.image(x, y, "iconMinerals").setDisplaySize(10, 10).setAlpha(0);
    } else {
      worker.carrying = this.add.circle(x + 6, y - 8, 2.5, 0x80ebff, 0);
    }

    worker.minimapDot = this.add.circle(0, 0, 2, this.theme.minimapDot, 0.92);
    this.syncWorkerVisual(worker);
    return worker;
  }

  private advanceWorkers(dt: number): void {
    for (const worker of this.model.workers) {
      const target = this.minerals[worker.targetMineral];
      const mineralApproach = this.getMineralApproachPoint(worker, target);
      const baseDock = this.getBaseDockPoint(worker);

      if (worker.phase === "toMineral") {
        if (this.moveWorker(worker, mineralApproach.x, mineralApproach.y, worker.speed * dt)) {
          worker.phase = "mining";
          worker.dwell = 0.42 + Math.random() * 0.35;
        }
        continue;
      }

      if (worker.phase === "mining") {
        worker.dwell -= dt;
        if (worker.dwell <= 0) {
          worker.phase = "toBase";
        }
        continue;
      }

      if (worker.phase === "toBase") {
        if (this.moveWorker(worker, baseDock.x, baseDock.y, worker.speed * dt)) {
          worker.phase = "deposit";
          worker.dwell = 0.28;
        }
        continue;
      }

      worker.dwell -= dt;
      if (worker.dwell <= 0) {
        worker.phase = "toMineral";
      }
    }
  }

  private applyWorkerSeparation(dt: number): void {
    const workers = this.model.workers;
    for (let i = 0; i < workers.length; i += 1) {
      const a = workers[i];
      for (let j = i + 1; j < workers.length; j += 1) {
        const b = workers[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > 18) {
          continue;
        }

        const push = ((18 - dist) / dist) * 9 * dt;
        a.x += dx * push;
        a.y += dy * push;
        b.x -= dx * push;
        b.y -= dy * push;
      }
    }
  }

  private animateAmbient(timeMs: number): void {
    if (!this.isStarcraftLocalPack()) {
      return;
    }

    const t = timeMs * 0.001;
    for (let i = 0; i < this.mineralVisuals.length; i += 1) {
      const entry = this.mineralVisuals[i];
      const pulse = (Math.sin(t * 2.4 + entry.phase) + 1) * 0.5;
      entry.glow.setAlpha(0.04 + pulse * 0.09);
    }

    if (this.basePulseRing) {
      const wave = (Math.sin(t * 1.75) + 1) * 0.5;
      this.basePulseRing.setScale(1 + wave * 0.04).setAlpha(0.52 + wave * 0.24);
    }

    if (this.baseBloom) {
      const wave = (Math.sin(t * 2.3 + 0.7) + 1) * 0.5;
      this.baseBloom.setAlpha(0.04 + wave * 0.07);
    }

    if (this.minimapSweep) {
      const normalized = (t * 0.24) % 1;
      this.minimapSweep
        .setY(MINIMAP_Y + 6 + normalized * (MINIMAP_H - 12))
        .setAlpha(0.11 + Math.sin(t * 5.1) * 0.03);
    }
  }

  private getBaseDockPoint(worker: WorkerAgent): Phaser.Math.Vector2 {
    const angle = (worker.lane * 1.17) % (Math.PI * 2);
    const rx = 42;
    const ry = 28;
    return new Phaser.Math.Vector2(
      this.basePoint.x + Math.cos(angle) * rx + 8,
      this.basePoint.y + Math.sin(angle) * ry + 12
    );
  }

  private getMineralApproachPoint(worker: WorkerAgent, mineral: Phaser.Math.Vector2): Phaser.Math.Vector2 {
    const toBase = new Phaser.Math.Vector2(this.basePoint.x - mineral.x, this.basePoint.y - mineral.y).normalize();
    const lateral = ((worker.lane % 4) - 1.5) * 8;
    const forward = 10 + Math.floor((worker.lane % 12) / 4) * 3;
    const perp = new Phaser.Math.Vector2(-toBase.y, toBase.x);
    return new Phaser.Math.Vector2(
      mineral.x + toBase.x * forward + perp.x * lateral,
      mineral.y + toBase.y * forward + perp.y * lateral
    );
  }

  private moveWorker(worker: WorkerAgent, targetX: number, targetY: number, step: number): boolean {
    const dx = targetX - worker.x;
    const dy = targetY - worker.y;
    const length = Math.hypot(dx, dy);

    if (length <= step || length === 0) {
      worker.x = targetX;
      worker.y = targetY;
      worker.vx = 0;
      worker.vy = 0;
      return true;
    }

    worker.targetFacingRad = Math.atan2(dy, dx);
    worker.vx = (dx / length) * step;
    worker.vy = (dy / length) * step;
    worker.x += worker.vx;
    worker.y += worker.vy;
    return false;
  }

  private snapAngle8(angle: number): number {
    const step = Math.PI / 4;
    return Math.round(angle / step) * step;
  }

  private syncWorkerVisual(worker: WorkerAgent): void {
    const starcraftLocal = this.isStarcraftLocalPack();
    const carrying = worker.phase === "toBase" || worker.phase === "deposit";
    const p = this.projectMapToScreen(worker.x, worker.y);
    const depth = p.depth + 14;
    const bob = Math.sin((this.time.now + worker.x * 2) / 130) * 0.9;
    const unitScale = (starcraftLocal ? 1.12 : 0.5) * p.scale;
    const carryScale = (starcraftLocal ? 0.24 : 0.16) * p.scale;
    const movement = Math.hypot(worker.vx, worker.vy);
    let headingRad = worker.facingRad;

    worker.shadow
      ?.setPosition(p.x + 6, p.y + 12)
      .setDisplaySize((starcraftLocal ? 28 : 22) * p.scale, (starcraftLocal ? 13 : 10) * p.scale)
      .setDepth(depth - 2)
      .setAlpha(starcraftLocal ? 0.4 : 0.32);

    worker.ring
      ?.setPosition(p.x + 6, p.y + 13)
      .setDisplaySize((starcraftLocal ? 30 : 20) * p.scale, (starcraftLocal ? 14 : 9) * p.scale)
      .setDepth(depth - 1)
      .setFillStyle(0x67d188, starcraftLocal ? 0.06 : 0)
      .setStrokeStyle(1, 0x78dc96, starcraftLocal ? 0.42 : 0.24);

    if (starcraftLocal) {
      worker.facingRad = Phaser.Math.Angle.RotateTo(worker.facingRad, worker.targetFacingRad, 0.18);
      const snappedFacing = this.snapAngle8(worker.facingRad);
      headingRad = snappedFacing;
      worker.sprite
        ?.setPosition(p.x, p.y + bob)
        .setScale(unitScale)
        .setDepth(depth)
        .setRotation(snappedFacing - Math.PI / 2)
        .setFlipX(false);
    } else {
      worker.sprite
        ?.setPosition(p.x, p.y + bob)
        .setScale(unitScale)
        .setDepth(depth)
        .setRotation(0)
        .setFlipX(worker.vx < -0.01);
      if (movement > 0.01) {
        headingRad = Math.atan2(worker.vy, worker.vx);
      }
    }

    worker.fallback
      ?.setPosition(p.x, p.y + bob)
      .setScale(unitScale)
      .setDepth(depth);

    if (worker.carrying instanceof Phaser.GameObjects.Image) {
      worker.carrying
        .setPosition(p.x + 7 * p.scale, p.y - 8 * p.scale + bob)
        .setScale(carryScale)
        .setDepth(depth + 1)
        .setAlpha(carrying ? 1 : 0);
    } else {
      worker.carrying
        ?.setPosition(p.x + 6 * p.scale, p.y - 8 * p.scale + bob)
        .setScale(p.scale)
        .setDepth(depth + 1)
        .setAlpha(carrying ? 1 : 0);
    }

    if (starcraftLocal && carrying) {
      worker.ring?.setStrokeStyle(1, 0xd2ffd6, 0.64).setFillStyle(0x67d188, 0.12);
    }

    const thrust = Phaser.Math.Clamp(movement / 1.2, 0, 1);
    const exhaustX = p.x - Math.cos(headingRad) * (9 * p.scale);
    const exhaustY = p.y - Math.sin(headingRad) * (7 * p.scale) + bob + 1;
    worker.thruster
      ?.setPosition(exhaustX, exhaustY)
      .setDepth(depth - 1)
      .setRadius((starcraftLocal ? 3.4 : 2.6) * p.scale)
      .setAlpha(starcraftLocal ? thrust * (carrying ? 0.85 : 0.62) : thrust * 0.4)
      .setFillStyle(carrying ? 0x9bfff1 : 0x74c6ff, 1);

    const mini = this.mapToMinimap(worker.x, worker.y);
    worker.minimapDot?.setPosition(mini.x, mini.y);
  }

  private syncMinimapBase(): void {
    const mini = this.mapToMinimap(this.basePoint.x, this.basePoint.y);
    this.minimapBase?.setPosition(mini.x, mini.y);
  }

  private drawMinimapBackdrops(): void {
    const g = this.add.graphics();
    g.lineStyle(1, 0x2d3240, 0.8);
    g.strokeRect(MINIMAP_X, MINIMAP_Y, MINIMAP_W, MINIMAP_H);

    for (const point of this.minerals) {
      const mini = this.mapToMinimap(point.x, point.y);
      this.add.circle(mini.x, mini.y, 2, 0x71e3ff, 0.85);
    }
  }

  private depthFactor(mapY: number): number {
    return Phaser.Math.Clamp((mapY - MAP_MIN_Y) / (MAP_MAX_Y - MAP_MIN_Y), 0, 1);
  }

  private projectMapToScreen(mapX: number, mapY: number): ProjectedPoint {
    if (this.isStarcraftLocalPack()) {
      const normalizedX = Phaser.Math.Clamp((mapX - MAP_MIN_X) / (MAP_MAX_X - MAP_MIN_X), 0, 1);
      const normalizedY = Phaser.Math.Clamp((mapY - MAP_MIN_Y) / (MAP_MAX_Y - MAP_MIN_Y), 0, 1);
      const curvedDepth = Math.pow(normalizedY, 1.35);
      const x = WORLD_X + 80 + normalizedX * (WORLD_WIDTH - 160) + (normalizedY - 0.5) * 14;
      const y = WORLD_Y + 54 + curvedDepth * (WORLD_HEIGHT - 100);
      const scale = 0.8 + normalizedY * 0.24;
      const depth = 260 + normalizedY * 360;
      return { x, y, scale, depth };
    }

    const depthFactor = this.depthFactor(mapY);
    const perspective = 0.62 + depthFactor * 0.48;
    const x = GAME_WIDTH / 2 + (mapX - GAME_WIDTH / 2) * perspective;
    const y = WORLD_Y + 36 + depthFactor * (WORLD_HEIGHT - 96);
    const scale = 0.58 + depthFactor * 0.74;
    const depth = 100 + depthFactor * 760;
    return { x, y, scale, depth };
  }

  private mapToMinimap(mapX: number, mapY: number): { x: number; y: number } {
    const normalizedX = Phaser.Math.Clamp((mapX - MAP_MIN_X) / (MAP_MAX_X - MAP_MIN_X), 0, 1);
    const normalizedY = Phaser.Math.Clamp((mapY - MAP_MIN_Y) / (MAP_MAX_Y - MAP_MIN_Y), 0, 1);
    return {
      x: MINIMAP_X + normalizedX * MINIMAP_W,
      y: MINIMAP_Y + normalizedY * MINIMAP_H
    };
  }
}

function themeTextures(theme: ThemeName): ThemeTextures {
  if (theme === "protoss") {
    return {
      uiTop: "uiTopProtoss",
      uiBottom: "uiBottomProtoss",
      portrait: "portraitWorkerProtoss",
      accentHex: "#eac36f",
      textHex: "#f8efd6",
      minimapDot: 0xf4d87a
    };
  }

  if (theme === "zerg") {
    return {
      uiTop: "uiTopZerg",
      uiBottom: "uiBottomZerg",
      portrait: "portraitWorkerZerg",
      accentHex: "#bf78dd",
      textHex: "#e9d7f2",
      minimapDot: 0xff8eb1
    };
  }

  return {
    uiTop: "uiTopTerran",
    uiBottom: "uiBottomTerran",
    portrait: "portraitWorkerTerran",
    accentHex: "#67b3ff",
    textHex: "#d5e8ff",
    minimapDot: 0x79c3ff
  };
}

async function bootstrap(): Promise<void> {
  const runtimeConfig = (await fetch("/runtime-config.json").then((res) => res.json())) as RuntimeConfig;
  const envelopeStore = new EnvelopeStore();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: "app",
    backgroundColor: "#07090d",
    scene: [new RtsScene(envelopeStore, runtimeConfig)],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
      antialias: false,
      pixelArt: true,
      roundPixels: true
    }
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
