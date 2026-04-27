import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  formatMemoryMarkdownEntry,
  type MemoryAppendRequest,
  type MemoryEntry,
  type MemoryManageRequest,
  type MemoryManageResult,
  type MemoryProvider,
  type MemoryProviderInfo,
  type MemoryReadRequest,
  type MemoryReadResult,
  type MemorySearchRequest,
  type MemorySearchResult,
  memoryEntryId,
  memoryShouldAutoCapture,
} from '@snapdragon-ai/content';
import type { LlmChatResponse, MessageContent } from '@snapdragon-ai/host';
import type { SdConfig } from './config.js';
import { DEFAULT_SD_MEMORY_ROOT } from './config.js';
import type { SdProfileInfo } from './profile.js';

export const DEFAULT_SD_MEMORY_FILE = 'MEMORY.md';

export interface SdMemoryStoreOptions {
  path: string;
  enabled?: boolean;
  authoring?: boolean;
  maxEntryChars?: number;
}

export interface MemoryCaptureResult {
  captured: boolean;
  id?: string;
  trigger?: string;
  reason?: string;
}

export class SdMemoryStore implements MemoryProvider {
  readonly path: string;
  readonly enabled: boolean;
  readonly authoring: boolean;
  readonly maxEntryChars: number | undefined;

  constructor(options: SdMemoryStoreOptions) {
    this.path = options.path;
    this.enabled = options.enabled ?? true;
    this.authoring = options.authoring ?? true;
    this.maxEntryChars = options.maxEntryChars;
    if (this.enabled) ensureMemoryFile(this.path);
  }

  info(): MemoryProviderInfo {
    return {
      id: 'sd-markdown',
      title: 'MEMORY.md',
      description: 'Append-only Markdown memory scratchpad.',
      writable: this.authoring,
      path: this.path,
    };
  }

  read(request: MemoryReadRequest = {}): MemoryReadResult {
    if (!this.enabled) return { entries: [] };
    const raw = readRaw(this.path);
    const entries = parseMemoryEntries(raw);
    const selected = request.id
      ? entries.filter((entry) => entry.id === request.id)
      : entries.slice(0, request.limit ?? entries.length);
    return { entries: selected, raw };
  }

  search(request: MemorySearchRequest): MemorySearchResult[] {
    if (!this.enabled) return [];
    const words = request.query
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (words.length === 0) return this.read({ limit: request.limit }).entries;
    return parseMemoryEntries(readRaw(this.path))
      .map((entry) => ({ ...entry, score: scoreMemory(entry, words) }))
      .filter((entry) => (entry.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.id.localeCompare(a.id))
      .slice(0, request.limit ?? 10);
  }

  append(request: MemoryAppendRequest): MemoryManageResult {
    if (!this.authoring) {
      return { success: false, action: 'append', error: 'Memory authoring is disabled.' };
    }
    const createdAt = new Date().toISOString();
    const id = memoryEntryId(createdAt);
    const entry = formatMemoryMarkdownEntry(request, {
      id,
      createdAt,
      maxEntryChars: this.maxEntryChars,
    });
    appendRaw(this.path, entry);
    return {
      success: true,
      action: 'append',
      id,
      path: this.path,
      message: `Appended memory ${id}.`,
    };
  }

  manage(request: MemoryManageRequest): MemoryManageResult {
    try {
      if (request.action === 'append') return this.append(request);
      if (!this.authoring) {
        return { success: false, action: request.action, error: 'Memory authoring is disabled.' };
      }
      if (request.action === 'patch') return this.#patch(request);
      if (request.action === 'replace') return this.#replace(request);
      if (request.action === 'delete') return this.#delete(request);
      return { success: false, action: request.action, error: `Unknown action: ${request.action}` };
    } catch (error) {
      return {
        success: false,
        action: request.action,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  contextForPrompt(prompt: MessageContent, limit = 5): string {
    if (!this.enabled) return '';
    const query = textFromContent(prompt);
    const entries = this.search({ query, limit });
    if (entries.length === 0) return '';
    return [
      '[MEMORY.md: Relevant durable notes. Use these as user/project preferences when applicable.]',
      ...entries.map((entry) => `- ${entry.title ?? entry.id}: ${oneLine(entry.content)}`),
    ].join('\n');
  }

  #patch(request: MemoryManageRequest): MemoryManageResult {
    const oldString = requiredString(request.old_string, 'old_string');
    const raw = readRaw(this.path);
    if (!raw.includes(oldString)) throw new Error('old_string not found.');
    const next = raw.replace(oldString, request.new_string ?? '');
    atomicWrite(this.path, next);
    return {
      success: true,
      action: 'patch',
      id: request.id,
      path: this.path,
      message: 'Patched memory.',
    };
  }

  #replace(request: MemoryManageRequest): MemoryManageResult {
    atomicWrite(this.path, normalizeMemoryFile(request.content ?? ''));
    return {
      success: true,
      action: 'replace',
      id: request.id,
      path: this.path,
      message: 'Replaced memory.',
    };
  }

  #delete(request: MemoryManageRequest): MemoryManageResult {
    const id = requiredString(request.id, 'id');
    const raw = readRaw(this.path);
    const entries = parseMemoryEntries(raw);
    const kept = entries.filter((entry) => entry.id !== id);
    if (kept.length === entries.length) throw new Error(`Memory not found: ${id}`);
    const next = ['# Snapdragon Memory', '', ...kept.map(formatParsedEntry)].join('\n');
    atomicWrite(this.path, normalizeMemoryFile(next));
    return { success: true, action: 'delete', id, path: this.path, message: `Deleted ${id}.` };
  }
}

export type SdMemoryProvider = MemoryProvider;

export function createSdMemoryStore(
  config: SdConfig,
  profile?: SdProfileInfo,
  providers: Map<string, MemoryProvider> = new Map(),
): SdMemoryProvider {
  const providerId = config.memory?.provider;
  if (providerId && providerId !== 'sd-markdown') {
    const provider = providers.get(providerId);
    if (!provider) throw new Error(`Memory provider '${providerId}' is not registered`);
    return provider;
  }
  return new SdMemoryStore({
    path: resolveSdMemoryPath(config, profile),
    enabled: config.memory?.enabled ?? true,
    authoring: config.memory?.authoring ?? true,
    maxEntryChars: config.memory?.auto?.max_entry_chars,
  });
}

export function resolveSdMemoryPath(config: SdConfig, profile?: SdProfileInfo): string {
  const root = profile?.dir
    ? join(profile.dir, 'memory')
    : resolve(config.memory?.root ?? DEFAULT_SD_MEMORY_ROOT);
  return join(root, config.memory?.file ?? DEFAULT_SD_MEMORY_FILE);
}

export function requestInputWithMemory(
  config: SdConfig,
  memory: SdMemoryProvider,
  visibleInput: MessageContent,
  requestInput?: MessageContent,
): Promise<MessageContent | undefined> | MessageContent | undefined {
  if (config.memory?.enabled === false || config.memory?.context?.enabled === false) {
    return requestInput;
  }
  const base = requestInput ?? visibleInput;
  return memoryContextForPrompt(
    memory,
    visibleInput,
    config.memory?.context?.max_entries ?? 5,
  ).then((context) => {
    if (!context) return requestInput;
    return prependTextContext(base, context);
  });
}

export function maybeAutoCaptureMemory(args: {
  config: SdConfig;
  memory: SdMemoryProvider;
  visibleInput: MessageContent;
  response?: LlmChatResponse;
  source?: string;
  tags?: string[];
  sessionAppendMeta?: (meta: Record<string, unknown>) => void | Promise<void>;
}): Promise<MemoryCaptureResult> | MemoryCaptureResult {
  const auto = args.config.memory?.auto;
  if (args.config.memory?.enabled === false || auto?.enabled === false) {
    return { captured: false, reason: 'disabled' };
  }
  const userInput = textFromContent(args.visibleInput);
  const decision = memoryShouldAutoCapture(
    {
      userInput,
      assistantOutput: args.response?.content,
      source: args.source,
      tags: args.tags,
    },
    {
      enabled: auto?.enabled,
      triggers: auto?.triggers,
      maxEntryChars: auto?.max_entry_chars,
      includeAssistant: auto?.include_assistant,
    },
  );
  if (!decision.capture)
    return { captured: false, trigger: decision.trigger, reason: decision.reason };
  const content = formatAutoMemoryContent({
    userInput,
    assistantOutput: auto?.include_assistant ? args.response?.content : undefined,
  });
  const appended = args.memory.append({
    title: `Auto capture: ${decision.trigger}`,
    content,
    tags: ['auto', ...(args.tags ?? [])],
    source: args.source ?? 'sd.auto',
  });
  return Promise.resolve(appended).then(async (result) => {
    if (result.success) {
      await args.sessionAppendMeta?.({
        memory_capture: {
          id: result.id,
          trigger: decision.trigger,
          path: result.path,
        },
      });
    }
    return {
      captured: result.success,
      id: result.id,
      trigger: decision.trigger,
      reason: result.error,
    };
  });
}

async function memoryContextForPrompt(
  memory: MemoryProvider,
  prompt: MessageContent,
  limit: number,
): Promise<string> {
  if (memory instanceof SdMemoryStore) return memory.contextForPrompt(prompt, limit);
  const query = textFromContent(prompt);
  const entries = await memory.search({ query, limit });
  if (entries.length === 0) return '';
  const info = await memory.info();
  return [
    `[${info.title ?? info.id}: Relevant durable notes. Use these as user/project preferences when applicable.]`,
    ...entries.map((entry) => `- ${entry.title ?? entry.id}: ${oneLine(entry.content)}`),
  ].join('\n');
}

function ensureMemoryFile(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    ['# Snapdragon Memory', '', 'Durable notes captured by sd and explicit memory tools.', ''].join(
      '\n',
    ),
    'utf8',
  );
}

function readRaw(path: string): string {
  ensureMemoryFile(path);
  return readFileSync(path, 'utf8');
}

function appendRaw(path: string, entry: string): void {
  ensureMemoryFile(path);
  const raw = readRaw(path);
  atomicWrite(path, normalizeMemoryFile(`${raw.trimEnd()}\n\n${entry}`));
}

function parseMemoryEntries(raw: string): MemoryEntry[] {
  const sections = raw.split(/\n(?=##\s+)/g).filter((section) => section.startsWith('## '));
  return sections.map(parseMemoryEntry).filter((entry): entry is MemoryEntry => Boolean(entry));
}

function parseMemoryEntry(section: string): MemoryEntry | undefined {
  const [heading = '', ...rest] = section.trim().split('\n');
  const headingMatch = heading.match(/^##\s+(.+?)(?:\s+-\s+(.+))?$/);
  if (!headingMatch) return undefined;
  const createdAt = headingMatch[1]?.trim();
  const title = headingMatch[2]?.trim();
  const bodyLines = rest;
  let id = createdAt ? memoryEntryId(createdAt) : memoryEntryId();
  let source: string | undefined;
  const tags: string[] = [];
  while (bodyLines.length > 0) {
    const line = bodyLines[0];
    if (!line.trim()) {
      bodyLines.shift();
      break;
    }
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('source:')) source = line.slice(7).trim();
    else if (line.startsWith('tags:'))
      tags.push(
        ...line
          .slice(5)
          .split(',')
          .map((tag) => tag.trim()),
      );
    else break;
    bodyLines.shift();
  }
  return {
    id,
    title,
    source,
    tags: tags.filter(Boolean),
    createdAt,
    content: bodyLines.join('\n').trim(),
  };
}

function formatParsedEntry(entry: MemoryEntry): string {
  return formatMemoryMarkdownEntry(
    {
      title: entry.title,
      content: entry.content,
      tags: entry.tags,
      source: entry.source,
    },
    { id: entry.id, createdAt: entry.createdAt ?? new Date().toISOString() },
  ).trimEnd();
}

function scoreMemory(entry: MemoryEntry, words: string[]): number {
  const haystack = [entry.id, entry.title, entry.content, entry.source, ...(entry.tags ?? [])]
    .join(' ')
    .toLowerCase();
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

function prependTextContext(content: MessageContent, context: string): MessageContent {
  if (typeof content === 'string') return `${context}\n\n${content}`;
  return [{ type: 'text', text: context }, ...content];
}

function textFromContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function formatAutoMemoryContent(input: { userInput: string; assistantOutput?: string }): string {
  return [
    'User supplied a stable preference, workflow note, or correction.',
    '',
    `User: ${input.userInput.trim()}`,
    input.assistantOutput ? `Assistant: ${input.assistantOutput.trim()}` : undefined,
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function requiredString(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempDir = join(tmpdir(), `snapdragon-memory-${Date.now()}-${Math.random().toString(36)}`);
  mkdirSync(tempDir, { recursive: true });
  const temp = join(tempDir, 'write.tmp');
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, path);
  rmSync(tempDir, { recursive: true, force: true });
}

function normalizeMemoryFile(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}
