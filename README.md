# ClaudeCraft

CLI to install StarCraft sound effects into Claude Code hooks.
Interactive prompts are powered by Clack (`@clack/prompts`).

## Demo

[![ClaudeCraft demo](assets/claudecraft-demo-short.gif)](assets/claudecraft-demo-short.mp4)

[Download demo video (MP4)](assets/claudecraft-demo-short.mp4)

## Run with npx

```bash
npx @wyverselabs/claudecraft
```

Examples:

```bash
npx @wyverselabs/claudecraft install --scope project --preset expanded --race random
npx @wyverselabs/claudecraft doctor --scope project
```

## Local development

```bash
bun install
bun run build
node dist/cli.js install --scope project --preset expanded --race random
```

## Commands

### Install StarCraft sounds

```bash
npx @wyverselabs/claudecraft install
npx @wyverselabs/claudecraft install --scope project --preset expanded --race protoss --tool-cooldown 2 --yes
```

### Fully interactive mode

```bash
npx @wyverselabs/claudecraft
```

Interactive menu labels are outcome-focused (for example, `Install StarCraft sounds`).

### Switch race/settings (no reinstall)

```bash
npx @wyverselabs/claudecraft switch --race zerg
npx @wyverselabs/claudecraft switch --race random --tool-cooldown 2 --failure-cooldown 20
```

### Uninstall hooks

```bash
npx @wyverselabs/claudecraft uninstall
npx @wyverselabs/claudecraft uninstall --scope global --yes
```

### Doctor

```bash
npx @wyverselabs/claudecraft doctor
npx @wyverselabs/claudecraft doctor --json
```

### Game mode (RTS dashboard)

```bash
npx @wyverselabs/claudecraft game --open
npx @wyverselabs/claudecraft game watch --open --idle-threshold 20
npx @wyverselabs/claudecraft game status
npx @wyverselabs/claudecraft game reset --yes
npx @wyverselabs/claudecraft game assets install --pack placeholder
npx @wyverselabs/claudecraft game assets doctor
```

### Run tests

```bash
bun test
```

### Rebuild tool sound pools (maintainers)

```bash
bun run curate:tool-sounds
```

## Notes

- Project scope writes `.claude/settings.local.json` in the selected project.
- Global scope writes `~/.claude/settings.json`.
- `--race` supports `protoss`, `terran`, `zerg`, `random`.
- `PostToolUseFailure` hook is installed in expanded mode (`Bash` matcher).
- Tool sounds (`PreToolUse`, `PostToolUse`) use a 2s cooldown by default (override with `--tool-cooldown`).
- Failure alerts use a 15s cooldown by default (override with `--failure-cooldown`).
- Failure noise filtering is on by default (disable with `--no-failure-filter`).
- `PreToolUse` and `PostToolUse` use race-specific sound pools for variety.
- `claudecraft game` launches a local browser dashboard with mining/production state.
- Dashboard renders animated worker shuttles (SCV/Probe/Drone flavor) between minerals and base.
- Game visuals default to generated placeholder assets; users can configure a local custom pack with `game assets install --pack starcraft-local --assets-dir <dir>`.
- `all-sounds/` is source/reference; active packaged sounds are copied into `curated-sounds/`.
- Sounds are auto-downloaded from GitHub on install when not present locally.
- You can override with `--sounds-dir /absolute/path/to/curated-sounds`.
- Existing non-ClaudeCraft hooks are preserved.
- Managed entries are tagged for safe uninstall.
