import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CODEX_HOOK_EVENTS, MANAGED_BY, type CodexHookEventName, type InstallScope } from "./types.js";

const BEGIN_NOTIFY_MARKER = "# BEGIN agentcraft managed notify";
const END_NOTIFY_MARKER = "# END agentcraft managed notify";
const BEGIN_HOOKS_FEATURE_MARKER = "# BEGIN agentcraft managed codex hooks";
const END_HOOKS_FEATURE_MARKER = "# END agentcraft managed codex hooks";
const MANAGED_HOOK_TIMEOUT_SEC = 10;

export interface ManagedCodexNotifyState {
  configPath: string;
  configFound: boolean;
  hasManagedNotify: boolean;
  hasConflictingNotify: boolean;
  notifyCommand?: string[];
}

export interface ManagedCodexHooksFeatureState {
  configPath: string;
  configFound: boolean;
  hasManagedFeature: boolean;
  hasExternalFeatureSetting: boolean;
  codexHooksEnabled: boolean;
}

export interface ManagedCodexHooksState {
  hooksPath: string;
  hooksFound: boolean;
  hasManagedHooks: boolean;
  installedEvents: CodexHookEventName[];
  parseError?: string;
}

interface ManagedCodexHookInput {
  event: CodexHookEventName;
  command: string;
}

export function resolveCodexConfigPath(input: {
  scope: InstallScope;
  projectDir?: string;
  configPath?: string;
}): string {
  if (input.configPath) {
    return path.resolve(input.configPath);
  }

  if (input.scope === "global") {
    return path.join(os.homedir(), ".codex", "config.toml");
  }

  const projectDir = input.projectDir ? path.resolve(input.projectDir) : process.cwd();
  return path.join(projectDir, ".codex", "config.toml");
}

export function resolveCodexHooksPath(configPath: string): string {
  return path.join(path.dirname(path.resolve(configPath)), "hooks.json");
}

export async function readManagedCodexNotifyState(
  configPath: string
): Promise<ManagedCodexNotifyState> {
  const resolvedPath = path.resolve(configPath);
  const content = await readTomlOrEmpty(resolvedPath);
  const preamble = getTopLevelPreamble(content);
  const block = getManagedBlock(content, BEGIN_NOTIFY_MARKER, END_NOTIFY_MARKER);
  return {
    configPath: resolvedPath,
    configFound: content.length > 0,
    hasManagedNotify: block !== undefined,
    hasConflictingNotify: hasTopLevelNotify(preamble) && block === undefined,
    notifyCommand: block ? parseNotifyCommand(block) : undefined
  };
}

export async function readManagedCodexHooksFeatureState(
  configPath: string
): Promise<ManagedCodexHooksFeatureState> {
  const resolvedPath = path.resolve(configPath);
  const content = await readTomlOrEmpty(resolvedPath);
  const managedBlock = getManagedBlock(
    content,
    BEGIN_HOOKS_FEATURE_MARKER,
    END_HOOKS_FEATURE_MARKER
  );
  const externalValue = parseCodexHooksSetting(
    removeManagedBlock(content, BEGIN_HOOKS_FEATURE_MARKER, END_HOOKS_FEATURE_MARKER)
  );

  return {
    configPath: resolvedPath,
    configFound: content.length > 0,
    hasManagedFeature: managedBlock !== undefined,
    hasExternalFeatureSetting: externalValue !== undefined,
    codexHooksEnabled: managedBlock !== undefined || externalValue === true
  };
}

export async function readManagedCodexHooksState(
  configPath: string
): Promise<ManagedCodexHooksState> {
  const hooksPath = resolveCodexHooksPath(configPath);
  const content = await readTextOrEmpty(hooksPath);
  if (!content.trim()) {
    return {
      hooksPath,
      hooksFound: false,
      hasManagedHooks: false,
      installedEvents: []
    };
  }

  try {
    const document = parseHooksDocument(content, hooksPath);
    const installedEvents = CODEX_HOOK_EVENTS.filter((event) =>
      hasManagedHookForEvent(document, event)
    );
    return {
      hooksPath,
      hooksFound: true,
      hasManagedHooks: installedEvents.length > 0,
      installedEvents
    };
  } catch (error) {
    return {
      hooksPath,
      hooksFound: true,
      hasManagedHooks: false,
      installedEvents: [],
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function upsertManagedCodexNotify(input: {
  configPath: string;
  command: string[];
}): Promise<{ added: boolean; updated: boolean }> {
  const resolvedPath = path.resolve(input.configPath);
  const content = await readTomlOrEmpty(resolvedPath);
  const block = buildManagedNotifyBlock(input.command);

  let nextContent: string;
  let added = false;
  let updated = false;

  const existingManagedBlock = getManagedBlock(content, BEGIN_NOTIFY_MARKER, END_NOTIFY_MARKER);
  if (existingManagedBlock !== undefined) {
    const withoutManagedBlock = normalizeTrailingWhitespace(
      content.replace(existingManagedBlock, "").replace(/\n{3,}/g, "\n\n")
    );
    nextContent = insertManagedNotifyBlock(withoutManagedBlock, block);
    updated = normalizeToml(content) !== normalizeToml(nextContent);
  } else {
    const preamble = getTopLevelPreamble(content);
    if (hasTopLevelNotify(preamble)) {
      throw new Error(
        `Codex config already defines a top-level notify command in ${resolvedPath}. ` +
          "Remove it first or use --config-path with a separate config."
      );
    }
    nextContent = insertManagedNotifyBlock(content, block);
    added = true;
  }

  if (!added && !updated) {
    return { added: false, updated: false };
  }

  await writeToml(resolvedPath, nextContent);
  return { added, updated };
}

export async function upsertManagedCodexHooksFeature(
  configPath: string
): Promise<{ added: boolean; updated: boolean }> {
  const resolvedPath = path.resolve(configPath);
  const content = await readTomlOrEmpty(resolvedPath);
  const existingManagedBlock = getManagedBlock(
    content,
    BEGIN_HOOKS_FEATURE_MARKER,
    END_HOOKS_FEATURE_MARKER
  );

  if (existingManagedBlock !== undefined) {
    return { added: false, updated: false };
  }

  const externalSetting = parseCodexHooksSetting(
    removeManagedBlock(content, BEGIN_HOOKS_FEATURE_MARKER, END_HOOKS_FEATURE_MARKER)
  );
  if (externalSetting === true) {
    return { added: false, updated: false };
  }
  if (externalSetting === false) {
    throw new Error(
      `Codex config already sets features.codex_hooks = false in ${resolvedPath}. ` +
        "Enable it first or remove that setting so AgentCraft can manage SessionStart/Stop hooks."
    );
  }

  const featuresSection = findTableSection(content, "features");
  const block = buildManagedHooksFeatureBlock(featuresSection === undefined);
  const nextContent =
    featuresSection === undefined
      ? appendManagedFeatureBlock(content, block)
      : insertIntoFeaturesSection(content, featuresSection, block);

  await writeToml(resolvedPath, nextContent);
  return { added: true, updated: false };
}

export async function upsertManagedCodexHooks(input: {
  configPath: string;
  hooks: ManagedCodexHookInput[];
}): Promise<{ added: number; updated: number }> {
  const hooksPath = resolveCodexHooksPath(input.configPath);
  const content = await readTextOrEmpty(hooksPath);
  const document = content.trim() ? parseHooksDocument(content, hooksPath) : {};
  const hooksObject = getOrCreateHooksObject(document);

  let added = 0;
  let updated = 0;

  for (const hook of input.hooks) {
    const result = upsertManagedHookGroup(hooksObject, hook);
    if (result.added) {
      added += 1;
    }
    if (result.updated) {
      updated += 1;
    }
  }

  if (added === 0 && updated === 0) {
    return { added: 0, updated: 0 };
  }

  await fs.mkdir(path.dirname(hooksPath), { recursive: true });
  await fs.writeFile(hooksPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { added, updated };
}

export async function uninstallManagedCodexNotify(
  configPath: string
): Promise<{ removed: boolean }> {
  const resolvedPath = path.resolve(configPath);
  const content = await readTomlOrEmpty(resolvedPath);
  const existingManagedBlock = getManagedBlock(content, BEGIN_NOTIFY_MARKER, END_NOTIFY_MARKER);
  if (existingManagedBlock === undefined) {
    return { removed: false };
  }

  const nextContent = normalizeTrailingWhitespace(
    content.replace(existingManagedBlock, "").replace(/\n{3,}/g, "\n\n")
  );
  await writeToml(resolvedPath, nextContent);
  return { removed: true };
}

export async function uninstallManagedCodexHooksFeature(
  configPath: string
): Promise<{ removed: boolean }> {
  const resolvedPath = path.resolve(configPath);
  const content = await readTomlOrEmpty(resolvedPath);
  const existingManagedBlock = getManagedBlock(
    content,
    BEGIN_HOOKS_FEATURE_MARKER,
    END_HOOKS_FEATURE_MARKER
  );
  if (existingManagedBlock === undefined) {
    return { removed: false };
  }

  const nextContent = normalizeTrailingWhitespace(
    content.replace(existingManagedBlock, "").replace(/\n{3,}/g, "\n\n")
  );
  await writeToml(resolvedPath, nextContent);
  return { removed: true };
}

export async function uninstallManagedCodexHooks(
  configPath: string
): Promise<{ removed: number; deletedFile: boolean }> {
  const hooksPath = resolveCodexHooksPath(configPath);
  const content = await readTextOrEmpty(hooksPath);
  if (!content.trim()) {
    return { removed: 0, deletedFile: false };
  }

  const document = parseHooksDocument(content, hooksPath);
  const hooksObject = document.hooks;
  if (!isObject(hooksObject)) {
    return { removed: 0, deletedFile: false };
  }

  let removed = 0;
  for (const event of CODEX_HOOK_EVENTS) {
    const groups = hooksObject[event];
    if (!Array.isArray(groups)) {
      continue;
    }

    const kept = groups.filter((group) => !groupContainsManagedHook(group, event));
    removed += groups.length - kept.length;
    if (kept.length > 0) {
      hooksObject[event] = kept;
    } else {
      delete hooksObject[event];
    }
  }

  if (removed === 0) {
    return { removed: 0, deletedFile: false };
  }

  if (Object.keys(hooksObject).length === 0) {
    delete document.hooks;
  }

  if (Object.keys(document).length === 0) {
    await fs.unlink(hooksPath);
    return { removed, deletedFile: true };
  }

  await fs.writeFile(hooksPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { removed, deletedFile: false };
}

function buildManagedNotifyBlock(command: string[]): string {
  const serialized = `[${command.map(quoteTomlString).join(", ")}]`;
  return `${BEGIN_NOTIFY_MARKER}\nnotify = ${serialized}\n${END_NOTIFY_MARKER}\n`;
}

function buildManagedHooksFeatureBlock(includeHeader: boolean): string {
  const header = includeHeader ? "[features]\n" : "";
  return `${BEGIN_HOOKS_FEATURE_MARKER}\n${header}codex_hooks = true\n${END_HOOKS_FEATURE_MARKER}\n`;
}

function insertManagedNotifyBlock(content: string, block: string): string {
  if (!content.trim()) {
    return block;
  }

  const firstTableIndex = findFirstTableIndex(content);
  const firstFeatureMarkerIndex = content.indexOf(BEGIN_HOOKS_FEATURE_MARKER);
  const insertionIndex =
    firstFeatureMarkerIndex !== -1 &&
    (firstTableIndex === -1 || firstFeatureMarkerIndex < firstTableIndex)
      ? firstFeatureMarkerIndex
      : firstTableIndex;

  if (insertionIndex === -1) {
    return `${normalizeTrailingWhitespace(content)}\n${block}`;
  }

  const prefix = content.slice(0, insertionIndex);
  const suffix = content.slice(insertionIndex);
  return `${normalizeTrailingWhitespace(prefix)}\n${block}${suffix.replace(/^\n*/, "")}`;
}

function appendManagedFeatureBlock(content: string, block: string): string {
  if (!content.trim()) {
    return block;
  }
  return `${normalizeTrailingWhitespace(content)}\n${block}`;
}

function insertIntoFeaturesSection(
  content: string,
  section: { headerEnd: number },
  block: string
): string {
  return `${content.slice(0, section.headerEnd)}${block}${content.slice(section.headerEnd)}`;
}

function upsertManagedHookGroup(
  hooksObject: Record<string, unknown>,
  input: ManagedCodexHookInput
): { added: boolean; updated: boolean } {
  const groups = getOrCreateEventGroups(hooksObject, input.event);
  const desiredGroup = buildManagedHookGroup(input.command);
  const managedIndexes = groups
    .map((group, index) => (groupContainsManagedHook(group, input.event) ? index : -1))
    .filter((index) => index >= 0);

  if (managedIndexes.length === 0) {
    groups.push(desiredGroup);
    return { added: true, updated: false };
  }

  let updated = false;
  for (let index = managedIndexes.length - 1; index >= 1; index -= 1) {
    groups.splice(managedIndexes[index], 1);
    updated = true;
  }

  const primaryIndex = managedIndexes[0];
  if (!managedHookGroupEquals(groups[primaryIndex], desiredGroup)) {
    groups[primaryIndex] = desiredGroup;
    updated = true;
  }

  return { added: false, updated };
}

function getOrCreateHooksObject(document: Record<string, unknown>): Record<string, unknown> {
  const existing = document.hooks;
  if (existing === undefined) {
    const created: Record<string, unknown> = {};
    document.hooks = created;
    return created;
  }
  if (!isObject(existing)) {
    throw new Error("Invalid Codex hooks file: expected \"hooks\" to be an object.");
  }
  return existing;
}

function getOrCreateEventGroups(
  hooksObject: Record<string, unknown>,
  event: CodexHookEventName
): unknown[] {
  const existing = hooksObject[event];
  if (existing === undefined) {
    const created: unknown[] = [];
    hooksObject[event] = created;
    return created;
  }
  if (!Array.isArray(existing)) {
    throw new Error(`Invalid Codex hooks file: expected hooks.${event} to be an array.`);
  }
  return existing;
}

function buildManagedHookGroup(command: string): Record<string, unknown> {
  return {
    hooks: [
      {
        type: "command",
        command,
        timeout: MANAGED_HOOK_TIMEOUT_SEC
      }
    ]
  };
}

function managedHookGroupEquals(group: unknown, desiredGroup: Record<string, unknown>): boolean {
  return JSON.stringify(normalizeManagedHookGroup(group)) === JSON.stringify(desiredGroup);
}

function normalizeManagedHookGroup(group: unknown): Record<string, unknown> | undefined {
  if (!isObject(group)) {
    return undefined;
  }
  const hooks = group.hooks;
  if (!Array.isArray(hooks)) {
    return undefined;
  }

  const commandHook = hooks.find((hook) => isManagedCommandHook(hook));
  if (!isObject(commandHook) || typeof commandHook.command !== "string") {
    return undefined;
  }

  const timeout = normalizeTimeout(commandHook.timeout, commandHook.timeoutSec);
  return {
    hooks: [
      {
        type: "command",
        command: commandHook.command,
        timeout
      }
    ]
  };
}

function normalizeTimeout(timeout: unknown, timeoutSec: unknown): number {
  if (typeof timeout === "number" && Number.isFinite(timeout)) {
    return Math.max(1, Math.trunc(timeout));
  }
  if (typeof timeoutSec === "number" && Number.isFinite(timeoutSec)) {
    return Math.max(1, Math.trunc(timeoutSec));
  }
  return MANAGED_HOOK_TIMEOUT_SEC;
}

function hasManagedHookForEvent(document: Record<string, unknown>, event: CodexHookEventName): boolean {
  if (!isObject(document.hooks)) {
    return false;
  }
  const groups = document.hooks[event];
  return Array.isArray(groups) && groups.some((group) => groupContainsManagedHook(group, event));
}

function groupContainsManagedHook(group: unknown, event: CodexHookEventName): boolean {
  if (!isObject(group) || !Array.isArray(group.hooks)) {
    return false;
  }

  return group.hooks.some((hook) => isManagedCommandHook(hook, event));
}

function isManagedCommandHook(hook: unknown, event?: CodexHookEventName): boolean {
  if (!isObject(hook) || hook.type !== "command" || typeof hook.command !== "string") {
    return false;
  }

  if (!hook.command.includes(`--managed-by "${MANAGED_BY}"`)) {
    return false;
  }

  return event ? hook.command.includes(`--event "${event}"`) : true;
}

function parseHooksDocument(content: string, hooksPath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Failed to parse Codex hooks file ${hooksPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!isObject(parsed)) {
    throw new Error(`Invalid Codex hooks file ${hooksPath}: expected a JSON object.`);
  }

  return parsed;
}

function getManagedBlock(content: string, beginMarker: string, endMarker: string): string | undefined {
  const start = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }
  const endIndex = content.indexOf("\n", end);
  return content.slice(start, endIndex === -1 ? content.length : endIndex + 1);
}

function removeManagedBlock(content: string, beginMarker: string, endMarker: string): string {
  const block = getManagedBlock(content, beginMarker, endMarker);
  if (!block) {
    return content;
  }
  return content.replace(block, "");
}

function findFirstTableIndex(content: string): number {
  const match = content.match(/^\s*\[[^\]]+\]/m);
  return match?.index ?? -1;
}

function getTopLevelPreamble(content: string): string {
  const firstTableIndex = findFirstTableIndex(content);
  return firstTableIndex === -1 ? content : content.slice(0, firstTableIndex);
}

function findTableSection(
  content: string,
  tableName: string
): { start: number; headerEnd: number; end: number } | undefined {
  const pattern = new RegExp(`^\\s*\\[${escapeRegex(tableName)}\\]\\s*$`, "m");
  const match = pattern.exec(content);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const headerStart = match.index;
  const lineEnd = content.indexOf("\n", headerStart);
  const headerEnd = lineEnd === -1 ? content.length : lineEnd + 1;
  const rest = content.slice(headerEnd);
  const nextTableMatch = /^\s*\[[^\]]+\]\s*$/m.exec(rest);
  const end = nextTableMatch?.index === undefined ? content.length : headerEnd + nextTableMatch.index;
  return { start: headerStart, headerEnd, end };
}

function hasTopLevelNotify(content: string): boolean {
  return /^\s*notify\s*=/m.test(content);
}

function parseNotifyCommand(block: string): string[] | undefined {
  const match = block.match(/notify\s*=\s*\[(.*)\]/s);
  if (!match) {
    return undefined;
  }

  const values = match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^"/, "").replace(/"$/, "").replace(/\\"/g, '"'));

  return values.length > 0 ? values : undefined;
}

function parseCodexHooksSetting(content: string): boolean | undefined {
  const match = content.match(/^\s*codex_hooks\s*=\s*(true|false)\s*$/m);
  if (!match) {
    return undefined;
  }
  return match[1] === "true";
}

function quoteTomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function readTomlOrEmpty(configPath: string): Promise<string> {
  return await readTextOrEmpty(configPath);
}

async function readTextOrEmpty(targetPath: string): Promise<string> {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function writeToml(configPath: string, content: string): Promise<void> {
  if (!content) {
    try {
      await fs.unlink(configPath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
    return;
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, content, "utf8");
}

function normalizeToml(content: string): string {
  return content.replace(/\s+$/, "");
}

function normalizeTrailingWhitespace(content: string): string {
  const trimmed = content.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
  return trimmed ? `${trimmed}\n` : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
