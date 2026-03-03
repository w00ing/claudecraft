#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";
import {
  runGameAssetsDoctor,
  runGameAssetsInstall,
  runGameReset,
  runGameStatus,
  runGameWatch
} from "./commands/game.js";
import { runInstall } from "./commands/install.js";
import { runSwitch } from "./commands/switch.js";
import { runUninstall } from "./commands/uninstall.js";
import { selectPrompt } from "./lib/prompt.js";
import { packageRootFromMeta } from "./lib/runtime-paths.js";
import type { GameAssetPackName, HookPreset, InstallScope, RaceOption } from "./lib/types.js";
import { showIntro, showOutro } from "./lib/ui.js";

const runtime = { packageRoot: packageRootFromMeta(import.meta.url) };

const program = new Command();
program
  .name("claudecraft")
  .description("Install StarCraft sounds into Claude Code hooks")
  .showHelpAfterError();

program
  .command("install")
  .description("Install or update managed hooks")
  .option("--scope <scope>", "project|global", parseScope)
  .option("--preset <preset>", "core|expanded", parsePreset)
  .option("--race <race>", "protoss|terran|zerg|random", parseRace)
  .option("--sounds-dir <path>", "Path to curated-sounds directory")
  .option("--tool-cooldown <seconds>", "Tool hook cooldown in seconds", parseInteger)
  .option("--failure-cooldown <seconds>", "Failure hook cooldown in seconds", parseInteger)
  .option("--no-failure-filter", "Disable failure noise filtering")
  .option("--project-dir <path>", "Project directory (for project scope)")
  .option("--config-path <path>", "Explicit Claude settings file path")
  .option("--yes", "Skip confirmation prompts")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runInstall(
      {
        scope: opts.scope as InstallScope | undefined,
        preset: opts.preset as HookPreset | undefined,
        race: opts.race as RaceOption | undefined,
        soundsDir: opts.soundsDir,
        toolCooldownSec: opts.toolCooldown,
        failureCooldownSec: opts.failureCooldown,
        failureFilter: opts.failureFilter,
        projectDir: opts.projectDir,
        configPath: opts.configPath,
        yes: opts.yes,
        verbose: opts.verbose
      },
      runtime
    );
  });

program
  .command("switch")
  .description("Switch race and update managed hook settings without reinstall")
  .option("--scope <scope>", "project|global", parseScope)
  .option("--race <race>", "protoss|terran|zerg|random", parseRace)
  .option("--sounds-dir <path>", "Path to curated-sounds directory")
  .option("--tool-cooldown <seconds>", "Tool hook cooldown in seconds", parseInteger)
  .option("--failure-cooldown <seconds>", "Failure hook cooldown in seconds", parseInteger)
  .option("--no-failure-filter", "Disable failure noise filtering")
  .option("--project-dir <path>", "Project directory (for project scope)")
  .option("--config-path <path>", "Explicit Claude settings file path")
  .option("--yes", "Skip confirmation prompts")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runSwitch(
      {
        scope: opts.scope as InstallScope | undefined,
        race: opts.race as RaceOption | undefined,
        soundsDir: opts.soundsDir,
        toolCooldownSec: opts.toolCooldown,
        failureCooldownSec: opts.failureCooldown,
        failureFilter: opts.failureFilter,
        projectDir: opts.projectDir,
        configPath: opts.configPath,
        yes: opts.yes,
        verbose: opts.verbose
      },
      runtime
    );
  });

program
  .command("uninstall")
  .description("Remove managed hooks")
  .option("--scope <scope>", "project|global", parseScope)
  .option("--project-dir <path>", "Project directory (for project scope)")
  .option("--config-path <path>", "Explicit Claude settings file path")
  .option("--yes", "Skip confirmation prompts")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runUninstall({
      scope: opts.scope as InstallScope | undefined,
      projectDir: opts.projectDir,
      configPath: opts.configPath,
      yes: opts.yes,
      verbose: opts.verbose
    });
  });

program
  .command("doctor")
  .description("Diagnose config and sound setup")
  .option("--scope <scope>", "project|global", parseScope)
  .option("--project-dir <path>", "Project directory (for project scope)")
  .option("--config-path <path>", "Explicit Claude settings file path")
  .option("--json", "Emit JSON report")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runDoctor(
      {
        scope: opts.scope as InstallScope | undefined,
        projectDir: opts.projectDir,
        configPath: opts.configPath,
        json: opts.json,
        verbose: opts.verbose
      },
      runtime
    );
  });

const game = program.command("game").description("Launch and manage game mode dashboard");

game
  .option("--scope <scope>", "project|global", parseScope)
  .option("--project-dir <path>", "Project directory (for project scope)")
  .option("--config-path <path>", "Explicit Claude settings file path")
  .option("--port <port>", "Dashboard port", parseInteger)
  .option(
    "--idle-threshold <seconds>",
    "Mark dashboard idle after N seconds without hook events",
    parseInteger
  )
  .option("--open", "Open dashboard in browser")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runGameWatch(
      {
        scope: opts.scope as InstallScope | undefined,
        projectDir: opts.projectDir,
        configPath: opts.configPath,
        port: opts.port,
        idleThresholdSec: opts.idleThreshold,
        open: opts.open,
        verbose: opts.verbose
      },
      runtime
    );
  });

game
  .command("watch")
  .description("Start local game dashboard server")
  .option("--scope <scope>", "project|global", parseScope)
  .option("--project-dir <path>", "Project directory (for project scope)")
  .option("--config-path <path>", "Explicit Claude settings file path")
  .option("--port <port>", "Dashboard port", parseInteger)
  .option(
    "--idle-threshold <seconds>",
    "Mark dashboard idle after N seconds without hook events",
    parseInteger
  )
  .option("--open", "Open dashboard in browser")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runGameWatch(
      {
        scope: opts.scope as InstallScope | undefined,
        projectDir: opts.projectDir,
        configPath: opts.configPath,
        port: opts.port,
        idleThresholdSec: opts.idleThreshold,
        open: opts.open,
        verbose: opts.verbose
      },
      runtime
    );
  });

game
  .command("status")
  .description("Show current game progression state")
  .option("--scope <scope>", "project|global", parseScope)
  .option("--project-dir <path>", "Project directory (for project scope)")
  .option("--config-path <path>", "Explicit Claude settings file path")
  .option("--json", "Emit JSON report")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runGameStatus({
      scope: opts.scope as InstallScope | undefined,
      projectDir: opts.projectDir,
      configPath: opts.configPath,
      json: opts.json,
      verbose: opts.verbose
    });
  });

game
  .command("reset")
  .description("Reset game progression state")
  .option("--scope <scope>", "project|global", parseScope)
  .option("--project-dir <path>", "Project directory (for project scope)")
  .option("--config-path <path>", "Explicit Claude settings file path")
  .option("--yes", "Skip confirmation prompts")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runGameReset({
      scope: opts.scope as InstallScope | undefined,
      projectDir: opts.projectDir,
      configPath: opts.configPath,
      yes: opts.yes,
      verbose: opts.verbose
    });
  });

const assets = game.command("assets").description("Install and inspect game visual packs");

assets
  .command("install")
  .description("Install or configure game visual asset pack")
  .option("--pack <pack>", "placeholder|starcraft-local", parseAssetPack)
  .option("--assets-dir <path>", "Path to custom starcraft-local asset directory")
  .option("--verbose", "Verbose output")
  .action(async (opts) => {
    await runGameAssetsInstall(
      {
        pack: opts.pack as GameAssetPackName | undefined,
        assetsDir: opts.assetsDir,
        verbose: opts.verbose
      },
      runtime
    );
  });

assets
  .command("doctor")
  .description("Check active game asset pack health")
  .option("--json", "Emit JSON report")
  .action(async (opts) => {
    await runGameAssetsDoctor(
      {
        json: opts.json
      },
      runtime
    );
  });

async function main(): Promise<void> {
  if (process.argv.length <= 2 && process.stdin.isTTY && process.stdout.isTTY) {
    showIntro(readCliTitle(runtime.packageRoot));
    const selection = await selectPrompt<
      "install" | "switch" | "uninstall" | "doctor" | "game" | "help"
    >(
      "Choose what to set up",
      [
        {
          label: "Install StarCraft sounds",
          value: "install",
          hint: "Download sounds and set Claude hooks"
        },
        {
          label: "Switch race",
          value: "switch",
          hint: "Protoss/Terran/Zerg/Random"
        },
        {
          label: "Remove ClaudeCraft setup",
          value: "uninstall",
          hint: "Remove managed hooks and local session state"
        },
        {
          label: "Check setup health",
          value: "doctor",
          hint: "Validate config, mappings, and playable sound files"
        },
        {
          label: "Launch RTS game dashboard",
          value: "game",
          hint: "Visualize mining, units, and production in browser"
        },
        {
          label: "Show command help",
          value: "help",
          hint: "List all commands and flags"
        }
      ]
    );

    if (selection === "help") {
      program.outputHelp();
      showOutro("Ready");
      return;
    }

    await program.parseAsync([process.argv[0], process.argv[1], selection]);
    return;
  }

  await program.parseAsync(process.argv);
}

function readCliTitle(packageRoot: string): string {
  const fallback = "ClaudeCraft";
  try {
    const packageJsonPath = path.join(packageRoot, "package.json");
    const content = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(content) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return `${fallback} v${parsed.version}`;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  showOutro("Command failed");
  process.exitCode = 1;
});

function parseScope(value: string): InstallScope {
  if (value === "project" || value === "global") {
    return value;
  }
  throw new Error("scope must be one of: project, global");
}

function parsePreset(value: string): HookPreset {
  if (value === "core" || value === "expanded") {
    return value;
  }
  throw new Error("preset must be one of: core, expanded");
}

function parseRace(value: string): RaceOption {
  if (value === "protoss" || value === "terran" || value === "zerg" || value === "random") {
    return value;
  }
  throw new Error("race must be one of: protoss, terran, zerg, random");
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error("expected an integer value");
  }
  return parsed;
}

function parseAssetPack(value: string): GameAssetPackName {
  if (value === "placeholder" || value === "starcraft-local") {
    return value;
  }
  throw new Error("pack must be one of: placeholder, starcraft-local");
}
