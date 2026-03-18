import { selectPrompt } from "./prompt.js";
import { resolveConfigPath as resolveClaudeConfigPath } from "./claude-config.js";
import { resolveCodexConfigPath } from "./codex-config.js";
import type { AgentProvider, InstallScope } from "./types.js";

export async function resolveAgentProvider(agent?: AgentProvider): Promise<AgentProvider> {
  if (agent) {
    return agent;
  }

  return await selectPrompt<AgentProvider>("AI agent:", [
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude" }
  ]);
}

export function resolveProviderConfigPath(input: {
  agent: AgentProvider;
  scope: InstallScope;
  projectDir?: string;
  configPath?: string;
}): string {
  if (input.agent === "claude") {
    return resolveClaudeConfigPath(input);
  }
  return resolveCodexConfigPath(input);
}
