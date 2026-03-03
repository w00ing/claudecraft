import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  installGameAssetsPack,
  doctorGameAssets,
  resolveGameAssets
} from "../lib/game-assets.js";
import {
  deriveGameStatePath,
  loadGameState,
  resetGameState,
  saveGameState
} from "../lib/game-state.js";
import { createInitialGameState } from "../lib/game-rules.js";
import { readSettings, resolveConfigPath } from "../lib/claude-config.js";
import { confirmPrompt } from "../lib/prompt.js";
import { isFixedRace } from "../lib/player-logic.js";
import { showOutro, withSpinner } from "../lib/ui.js";
import type {
  FixedRace,
  GameAssetsDoctorOptions,
  GameAssetsInstallOptions,
  GameAssetKey,
  GameResetOptions,
  GameSessionStatus,
  GameState,
  GameStateEnvelope,
  GameStatusOptions,
  GameWatchOptions,
  InstallScope
} from "../lib/types.js";

const DEFAULT_GAME_PORT = 4317;
const DEFAULT_IDLE_THRESHOLD_SEC = 20;
const MAX_VISUAL_SCVS = 200;

interface GameContext {
  configPath: string;
  gameStatePath: string;
  race: FixedRace;
}

export async function runGameWatch(
  options: GameWatchOptions,
  runtime: { packageRoot: string }
): Promise<void> {
  const context = await resolveGameContext(options);
  const resolvedAssets = await withSpinner(
    "Preparing game assets",
    () => resolveGameAssets({ packageRoot: runtime.packageRoot, verbose: options.verbose }),
    "Assets ready"
  );

  if (resolvedAssets.fallbackReason) {
    process.stdout.write(`Asset fallback: ${resolvedAssets.fallbackReason}\n`);
  }

  const idleThresholdSec = normalizeIdleThreshold(options.idleThresholdSec);
  const gameState = await ensureStateExists(context.gameStatePath, context.race);
  const port = options.port ?? DEFAULT_GAME_PORT;
  const clients = new Set<http.ServerResponse>();

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const parsed = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    if (method === "GET" && parsed.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(buildDashboardHtml(context.race, idleThresholdSec));
      return;
    }

    if (method === "GET" && parsed.pathname === "/api/state") {
      const state = (await loadGameState(context.gameStatePath)) ?? gameState;
      const envelope = buildGameStateEnvelope(state, context.gameStatePath, idleThresholdSec);
      writeJson(res, envelope);
      return;
    }

    if (method === "GET" && parsed.pathname === "/api/events/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      clients.add(res);
      const state = (await loadGameState(context.gameStatePath)) ?? gameState;
      const envelope = buildGameStateEnvelope(state, context.gameStatePath, idleThresholdSec);
      res.write(`data: ${JSON.stringify(envelope)}\n\n`);
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    if (method === "GET" && parsed.pathname.startsWith("/assets/")) {
      const key = parsed.pathname.replace("/assets/", "") as GameAssetKey;
      const filePath = resolvedAssets.files[key];
      if (!filePath) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      try {
        const bytes = await fs.readFile(filePath);
        res.writeHead(200, {
          "content-type": contentTypeFor(filePath),
          "cache-control": "no-store"
        });
        res.end(bytes);
      } catch {
        res.writeHead(404);
        res.end("missing asset");
      }
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const gameDir = path.dirname(context.gameStatePath);
  const gameFileName = path.basename(context.gameStatePath);
  const watcher = fsSync.watch(gameDir, async (_eventType, filename) => {
    const changed = typeof filename === "string" ? filename : String(filename ?? "");
    if (changed !== gameFileName) {
      return;
    }

    const state = await loadGameState(context.gameStatePath);
    if (!state) {
      return;
    }

    const envelope = buildGameStateEnvelope(state, context.gameStatePath, idleThresholdSec);
    const payload = `data: ${JSON.stringify(envelope)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  });

  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(`Race: ${context.race}\n`);
  process.stdout.write(`Config: ${context.configPath}\n`);
  process.stdout.write(`Game state: ${context.gameStatePath}\n`);
  process.stdout.write(`Idle threshold: ${idleThresholdSec}s\n`);
  process.stdout.write(`Game dashboard: ${url}\n`);

  if (options.open) {
    openBrowser(url);
  }

  await waitForShutdown();
  watcher.close();
  for (const client of clients) {
    client.end();
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  showOutro("Game server stopped");
}

export async function runGameStatus(options: GameStatusOptions): Promise<void> {
  const context = await resolveGameContext(options);
  const state = await loadGameState(context.gameStatePath);

  if (options.json) {
    writeJsonToStdout({
      configPath: context.configPath,
      gameStatePath: context.gameStatePath,
      race: context.race,
      envelope: state
        ? buildGameStateEnvelope(state, context.gameStatePath, DEFAULT_IDLE_THRESHOLD_SEC)
        : null
    });
    return;
  }

  process.stdout.write(`Config: ${context.configPath}\n`);
  process.stdout.write(`Race: ${context.race}\n`);
  process.stdout.write(`State file: ${context.gameStatePath}\n`);
  if (!state) {
    process.stdout.write("State: not initialized (run `claudecraft game` to start)\n");
    return;
  }

  const envelope = buildGameStateEnvelope(state, context.gameStatePath, DEFAULT_IDLE_THRESHOLD_SEC);
  process.stdout.write(`Session status: ${envelope.sessionStatus}\n`);
  process.stdout.write(`Tick: ${state.tick}\n`);
  process.stdout.write(`Minerals: ${state.minerals}\n`);
  process.stdout.write(`Workers: ${state.workers} (mining ${state.workersMining})\n`);
  process.stdout.write(`Queue: ${state.productionQueue.length}\n`);
  process.stdout.write(`Events handled: ${state.stats.eventsHandled}\n`);
  process.stdout.write(`Failures: ${state.stats.failures}\n`);
}

export async function runGameReset(options: GameResetOptions): Promise<void> {
  const context = await resolveGameContext(options);

  if (!options.yes) {
    const shouldContinue = await confirmPrompt(`Reset game state at ${context.gameStatePath}?`);
    if (!shouldContinue) {
      process.stdout.write("Cancelled.\n");
      return;
    }
  }

  const removed = await resetGameState(context.gameStatePath);
  process.stdout.write(`State file: ${context.gameStatePath}\n`);
  process.stdout.write(removed ? "Game state reset.\n" : "No state file found.\n");
}

export async function runGameAssetsInstall(
  options: GameAssetsInstallOptions,
  runtime: { packageRoot: string }
): Promise<void> {
  const pack = options.pack ?? "placeholder";
  const result = await withSpinner(
    `Installing ${pack} asset pack`,
    () =>
      installGameAssetsPack({
        packageRoot: runtime.packageRoot,
        pack,
        assetsDir: options.assetsDir,
        verbose: options.verbose
      }),
    "Asset pack configured"
  );

  process.stdout.write(`Selected pack: ${result.selectedPack}\n`);
  process.stdout.write(`Source directory: ${result.sourceDir}\n`);
}

export async function runGameAssetsDoctor(
  options: GameAssetsDoctorOptions,
  runtime: { packageRoot: string }
): Promise<void> {
  const report = await doctorGameAssets(runtime.packageRoot);
  if (options.json) {
    writeJsonToStdout(report);
    return;
  }

  process.stdout.write(`Config: ${report.configPath}\n`);
  process.stdout.write(`Config exists: ${report.configExists ? "yes" : "no"}\n`);
  process.stdout.write(`Selected pack: ${report.selectedPack}\n`);
  process.stdout.write(`Source dir: ${report.sourceDir}\n`);
  process.stdout.write(
    report.fallbackReason ? `Fallback: ${report.fallbackReason}\n` : "Fallback: none\n"
  );
  if (report.missingFiles.length > 0) {
    process.stdout.write(`Missing files:\n- ${report.missingFiles.join("\n- ")}\n`);
  } else {
    process.stdout.write("Missing files: none\n");
  }
}

async function resolveGameContext(options: {
  scope?: InstallScope;
  projectDir?: string;
  configPath?: string;
}): Promise<GameContext> {
  const scope = options.scope ?? "project";
  const configPath = resolveConfigPath({
    scope,
    projectDir: options.projectDir,
    configPath: options.configPath
  });
  const settings = await readSettings(configPath);

  const stateFilePath =
    typeof settings.claudecraft?.stateFile === "string"
      ? settings.claudecraft.stateFile
      : path.join(path.dirname(configPath), "claudecraft-session.json");

  const gameStatePath = deriveGameStatePath({ configPath, stateFilePath });
  const race = await resolveRace(settings.claudecraft?.race, gameStatePath);
  return { configPath, gameStatePath, race };
}

async function resolveRace(configuredRace: unknown, gameStatePath: string): Promise<FixedRace> {
  if (configuredRace === "protoss" || configuredRace === "terran" || configuredRace === "zerg") {
    return configuredRace;
  }

  const existingState = await loadGameState(gameStatePath);
  if (existingState?.race && isFixedRace(existingState.race)) {
    return existingState.race;
  }

  return "terran";
}

async function ensureStateExists(gameStatePath: string, race: FixedRace): Promise<GameState> {
  const existing = await loadGameState(gameStatePath);
  if (existing) {
    return existing;
  }

  const initialized = createInitialGameState(race);
  await saveGameState(gameStatePath, initialized);
  return initialized;
}

export function buildGameStateEnvelope(
  state: GameState,
  boundGameStatePath: string,
  idleThresholdSec: number,
  nowMs: number = Date.now()
): GameStateEnvelope {
  const activity = computeSessionActivity(state, idleThresholdSec, nowMs);
  return {
    state,
    sessionStatus: activity.sessionStatus,
    lastEventAt: activity.lastEventAt,
    idleSeconds: activity.idleSeconds,
    boundGameStatePath
  };
}

export function computeSessionActivity(
  state: GameState,
  idleThresholdSec: number,
  nowMs: number
): {
  sessionStatus: GameSessionStatus;
  lastEventAt?: string;
  idleSeconds?: number;
} {
  const lastEventAt = state.stats.lastEventAt;
  if (!lastEventAt) {
    return {
      sessionStatus: "idle",
      lastEventAt: undefined,
      idleSeconds: undefined
    };
  }

  const timestampMs = Date.parse(lastEventAt);
  if (!Number.isFinite(timestampMs)) {
    return {
      sessionStatus: "idle",
      lastEventAt,
      idleSeconds: undefined
    };
  }

  const idleSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  const sessionStatus: GameSessionStatus = idleSeconds > idleThresholdSec ? "idle" : "live";
  return {
    sessionStatus,
    lastEventAt,
    idleSeconds
  };
}

export function normalizeIdleThreshold(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return DEFAULT_IDLE_THRESHOLD_SEC;
  }
  return Math.max(1, Math.floor(value));
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filePath.endsWith(".png")) {
    return "image/png";
  }
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (filePath.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
}

function writeJson(res: http.ServerResponse, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function writeJsonToStdout(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function openBrowser(url: string): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const onSignal = () => {
      if (done) {
        return;
      }
      done = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

function buildDashboardHtml(race: FixedRace, idleThresholdSec: number): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ClaudeCraft RTS</title>
    <style>
      :root {
        --bg-0: #09131f;
        --bg-1: #10253b;
        --panel: #142940;
        --panel-border: #2f4c68;
        --text: #e5edf5;
        --muted: #90a4b7;
        --accent: #4db6ff;
        --live: #34d399;
        --idle: #f59e0b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--text);
        font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
        min-height: 100vh;
        background:
          radial-gradient(circle at 12% 18%, rgba(77, 182, 255, 0.22), transparent 35%),
          radial-gradient(circle at 82% 6%, rgba(124, 92, 255, 0.12), transparent 25%),
          linear-gradient(160deg, var(--bg-0), var(--bg-1));
      }
      .wrap {
        max-width: 1180px;
        margin: 0 auto;
        padding: 24px 16px 40px;
      }
      .hero {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 20px;
      }
      .title {
        margin: 0;
        font-size: 24px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .race {
        color: var(--accent);
        font-weight: 700;
      }
      .status {
        margin-top: 8px;
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        border: 1px solid transparent;
      }
      .status.live {
        color: #03120d;
        background: var(--live);
      }
      .status.idle {
        color: #281500;
        background: var(--idle);
      }
      .session {
        margin-top: 8px;
        color: var(--muted);
        font-size: 12px;
      }
      .idle-note {
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .card {
        background: color-mix(in oklab, var(--panel), black 8%);
        border: 1px solid var(--panel-border);
        border-radius: 14px;
        padding: 14px;
      }
      .metric {
        font-size: 28px;
        font-weight: 700;
      }
      .label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .section {
        margin-top: 18px;
      }
      .section h2 {
        margin: 0 0 8px;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .battlefield-wrap {
        position: relative;
        overflow: hidden;
      }
      canvas {
        width: 100%;
        height: auto;
        border: 1px solid var(--panel-border);
        border-radius: 12px;
        background: #08121d;
      }
      .worker-cap {
        margin-top: 8px;
        color: var(--muted);
        font-size: 12px;
      }
      .list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }
      .row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
      }
      .muted { color: var(--muted); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="hero">
        <div>
          <h1 class="title">ClaudeCraft Operations Console</h1>
          <div class="race">Race: ${race}</div>
        </div>
        <div>
          <div id="session-status" class="status idle">IDLE</div>
          <div id="session-path" class="session">Session: -</div>
          <div id="idle-note" class="idle-note">Idle threshold: ${idleThresholdSec}s</div>
        </div>
      </div>

      <div class="grid">
        <div class="card"><div class="label">Minerals</div><div id="minerals" class="metric">0</div></div>
        <div class="card"><div class="label">Workers</div><div id="workers" class="metric">0</div></div>
        <div class="card"><div class="label">Queue</div><div id="queue-size" class="metric">0</div></div>
        <div class="card"><div class="label">Tick</div><div id="tick" class="metric">0</div></div>
      </div>

      <div class="card section battlefield-wrap">
        <h2>Battlefield</h2>
        <canvas id="battlefield" width="960" height="320" aria-label="SCV mining loop"></canvas>
        <div id="worker-cap" class="worker-cap"></div>
      </div>

      <div class="grid section">
        <div class="card">
          <h2>Units</h2>
          <ul id="units" class="list"></ul>
        </div>
        <div class="card">
          <h2>Production Queue</h2>
          <ul id="queue" class="list"></ul>
        </div>
      </div>

      <div class="card section">
        <h2>Recent Events</h2>
        <ul id="events" class="list"></ul>
      </div>
    </div>

    <script>
      const MAX_VISUAL_SCVS = ${MAX_VISUAL_SCVS};
      const WORLD_W = 960;
      const WORLD_H = 320;

      const mineralsEl = document.getElementById('minerals');
      const workersEl = document.getElementById('workers');
      const queueSizeEl = document.getElementById('queue-size');
      const tickEl = document.getElementById('tick');
      const unitsEl = document.getElementById('units');
      const queueEl = document.getElementById('queue');
      const eventsEl = document.getElementById('events');
      const statusEl = document.getElementById('session-status');
      const sessionPathEl = document.getElementById('session-path');
      const idleNoteEl = document.getElementById('idle-note');
      const workerCapEl = document.getElementById('worker-cap');
      const canvas = document.getElementById('battlefield');
      const ctx = canvas.getContext('2d');

      const anchors = {
        base: { x: 170, y: 168 },
        minerals: [
          { x: 700, y: 92 },
          { x: 760, y: 150 },
          { x: 690, y: 214 },
          { x: 812, y: 242 },
          { x: 640, y: 142 }
        ]
      };

      const images = {
        base: new Image(),
        worker: new Image(),
        mineralPatch: new Image()
      };
      images.base.src = '/assets/base';
      images.worker.src = '/assets/worker';
      images.mineralPatch.src = '/assets/mineralPatch';

      const scene = {
        scvs: [],
        totalWorkers: 0,
        shownWorkers: 0,
        overflowWorkers: 0,
        lastTs: performance.now()
      };

      function hasLoadedImage(img) {
        return !!img && img.complete && img.naturalWidth > 0;
      }

      function moveToward(unit, targetX, targetY, distance) {
        const dx = targetX - unit.x;
        const dy = targetY - unit.y;
        const len = Math.hypot(dx, dy);
        if (len <= distance || len === 0) {
          unit.x = targetX;
          unit.y = targetY;
          return true;
        }
        unit.x += (dx / len) * distance;
        unit.y += (dy / len) * distance;
        return false;
      }

      function makeScv(index) {
        const offset = index % 6;
        return {
          id: index,
          x: anchors.base.x + ((offset % 3) - 1) * 18,
          y: anchors.base.y + (Math.floor(offset / 3) - 0.5) * 18,
          phase: 'toMineral',
          targetMineral: index % anchors.minerals.length,
          dwell: 0,
          speed: 72 + (index % 5) * 7,
          carrying: false
        };
      }

      function reconcileScvs(workersMining) {
        const total = Math.max(0, Number(workersMining) || 0);
        const shown = Math.min(total, MAX_VISUAL_SCVS);
        scene.totalWorkers = total;
        scene.shownWorkers = shown;
        scene.overflowWorkers = Math.max(0, total - shown);

        while (scene.scvs.length < shown) {
          scene.scvs.push(makeScv(scene.scvs.length));
        }
        if (scene.scvs.length > shown) {
          scene.scvs.length = shown;
        }

        for (let i = 0; i < scene.scvs.length; i += 1) {
          scene.scvs[i].targetMineral = i % anchors.minerals.length;
        }
      }

      function updateScv(scv, dt) {
        const mineral = anchors.minerals[scv.targetMineral];

        if (scv.phase === 'toMineral') {
          const reached = moveToward(scv, mineral.x, mineral.y, scv.speed * dt);
          if (reached) {
            scv.phase = 'mining';
            scv.dwell = 0.55;
            scv.carrying = false;
          }
          return;
        }

        if (scv.phase === 'mining') {
          scv.dwell -= dt;
          if (scv.dwell <= 0) {
            scv.phase = 'toBase';
            scv.carrying = true;
          }
          return;
        }

        if (scv.phase === 'toBase') {
          const reached = moveToward(scv, anchors.base.x + 24, anchors.base.y + 16, scv.speed * dt);
          if (reached) {
            scv.phase = 'deposit';
            scv.dwell = 0.35;
          }
          return;
        }

        scv.dwell -= dt;
        if (scv.dwell <= 0) {
          scv.phase = 'toMineral';
          scv.carrying = false;
        }
      }

      function drawBackground() {
        const gradient = ctx.createLinearGradient(0, 0, WORLD_W, WORLD_H);
        gradient.addColorStop(0, '#081321');
        gradient.addColorStop(1, '#0d2035');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        for (let i = 0; i < WORLD_W; i += 32) {
          ctx.fillRect(i, 0, 1, WORLD_H);
        }
        for (let j = 0; j < WORLD_H; j += 32) {
          ctx.fillRect(0, j, WORLD_W, 1);
        }
      }

      function drawBase() {
        const size = 120;
        const x = anchors.base.x - size / 2;
        const y = anchors.base.y - size / 2;
        if (hasLoadedImage(images.base)) {
          ctx.drawImage(images.base, x, y, size, size);
          return;
        }
        ctx.fillStyle = '#6f7fd6';
        ctx.beginPath();
        ctx.arc(anchors.base.x, anchors.base.y, 44, 0, Math.PI * 2);
        ctx.fill();
      }

      function drawMinerals() {
        for (const node of anchors.minerals) {
          const size = 68;
          const x = node.x - size / 2;
          const y = node.y - size / 2;
          if (hasLoadedImage(images.mineralPatch)) {
            ctx.drawImage(images.mineralPatch, x, y, size, size);
          } else {
            ctx.fillStyle = '#3da6c7';
            ctx.beginPath();
            ctx.moveTo(node.x - 16, node.y + 14);
            ctx.lineTo(node.x - 10, node.y - 14);
            ctx.lineTo(node.x + 12, node.y - 10);
            ctx.lineTo(node.x + 18, node.y + 12);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      function drawScvs(timeSec) {
        for (let i = 0; i < scene.scvs.length; i += 1) {
          const scv = scene.scvs[i];
          const bob = Math.sin((timeSec * 5) + i) * 2;
          const size = 28;
          const x = scv.x - size / 2;
          const y = scv.y - size / 2 + bob;

          if (hasLoadedImage(images.worker)) {
            ctx.drawImage(images.worker, x, y, size, size);
          } else {
            ctx.fillStyle = '#7db36f';
            ctx.beginPath();
            ctx.arc(scv.x, scv.y + bob, 8, 0, Math.PI * 2);
            ctx.fill();
          }

          if (scv.carrying) {
            ctx.fillStyle = 'rgba(72, 215, 255, 0.95)';
            ctx.beginPath();
            ctx.arc(scv.x + 8, scv.y - 8 + bob, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      function drawScene(nowTs) {
        const timeSec = nowTs / 1000;
        drawBackground();
        drawMinerals();
        drawBase();
        drawScvs(timeSec);
      }

      function renderPanels(state) {
        mineralsEl.textContent = String(state.minerals ?? 0);
        workersEl.textContent = String(state.workersMining ?? 0);
        queueSizeEl.textContent = String((state.productionQueue || []).length);
        tickEl.textContent = String(state.tick ?? 0);

        unitsEl.innerHTML = '';
        Object.entries(state.units || {})
          .sort((a, b) => a[0].localeCompare(b[0]))
          .forEach(([name, count]) => {
            const li = document.createElement('li');
            li.className = 'row';
            li.innerHTML = '<span>' + name + '</span><span>' + count + '</span>';
            unitsEl.appendChild(li);
          });

        queueEl.innerHTML = '';
        (state.productionQueue || []).forEach((item) => {
          const li = document.createElement('li');
          li.className = 'row';
          li.innerHTML =
            '<span>' +
            item.unitType +
            '</span><span class="muted">finishes @ ' +
            item.finishAtTick +
            '</span>';
          queueEl.appendChild(li);
        });

        eventsEl.innerHTML = '';
        [...(state.recentEvents || [])]
          .reverse()
          .slice(0, 12)
          .forEach((evt) => {
            const li = document.createElement('li');
            const note = evt.delta?.note || 'update';
            const delta = evt.delta?.minerals ?? 0;
            li.innerHTML =
              '<span>' +
              evt.sourceEvent +
              ' <span class="muted">' +
              note +
              '</span></span><span class="muted">' +
              (delta >= 0 ? '+' : '') +
              delta +
              ' minerals</span>';
            li.className = 'row';
            eventsEl.appendChild(li);
          });
      }

      function renderEnvelope(envelope) {
        const state = envelope.state;
        renderPanels(state);

        reconcileScvs(state.workersMining || 0);
        if (scene.overflowWorkers > 0) {
          workerCapEl.textContent =
            'Showing ' +
            scene.shownWorkers +
            ' SCVs, aggregating +' +
            scene.overflowWorkers +
            ' workers';
        } else {
          workerCapEl.textContent = 'Rendering ' + scene.shownWorkers + ' active SCVs';
        }

        const status = envelope.sessionStatus === 'live' ? 'live' : 'idle';
        statusEl.className = 'status ' + status;
        let statusText = status.toUpperCase();
        if (typeof envelope.idleSeconds === 'number') {
          statusText += ' ' + envelope.idleSeconds + 's';
        }
        statusEl.textContent = statusText;

        sessionPathEl.textContent = 'Session: ' + (envelope.boundGameStatePath || '-');
        if (status === 'idle') {
          idleNoteEl.textContent =
            'No recent hook events. Waiting for active Claude session updates.';
        } else {
          idleNoteEl.textContent = 'Live updates from active Claude session.';
        }
      }

      function animationFrame(ts) {
        const dt = Math.min(0.05, Math.max(0.001, (ts - scene.lastTs) / 1000));
        scene.lastTs = ts;

        for (let i = 0; i < scene.scvs.length; i += 1) {
          updateScv(scene.scvs[i], dt);
        }

        drawScene(ts);
        requestAnimationFrame(animationFrame);
      }

      async function bootstrap() {
        const initial = await fetch('/api/state').then((r) => r.json());
        renderEnvelope(initial);

        const stream = new EventSource('/api/events/stream');
        stream.onmessage = (event) => {
          try {
            renderEnvelope(JSON.parse(event.data));
          } catch {
            // ignore malformed event payload
          }
        };

        requestAnimationFrame(animationFrame);
      }

      bootstrap();
    </script>
  </body>
</html>`;
}
