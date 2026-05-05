import { parse as parseYaml } from 'yaml';
import type { ExtensionManifest } from './extension-types.js';

export type {
  ExtensionApplianceManifest,
  ExtensionContributionManifest,
  ExtensionDescriptor,
  ExtensionGatewayContributionManifest,
  ExtensionGatewayServiceManifest,
  ExtensionManifest,
} from './extension-types.js';

export const SKILL_INDEX_FILE = 'SKILL.md';

export interface SkillFrontmatter {
  name: string;
  description: string;
  aliases?: string[];
  tags?: string[] | string;
  category?: string;
  platforms?: string[] | string;
  metadata?: {
    short_description?: string;
    'short-description'?: string;
    hermes?: {
      tags?: string[] | string;
      related_skills?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  command: string;
  aliases: string[];
  category: string;
  tags: string[];
  source?: string;
  sourceRoot?: string;
  writable?: boolean;
  path?: string;
  dir?: string;
}

export interface SkillLinkedFiles {
  references?: string[];
  templates?: string[];
  scripts?: string[];
  assets?: string[];
}

export interface LoadedSkill extends SkillDescriptor {
  frontmatter: SkillFrontmatter;
  body: string;
  raw: string;
  linkedFiles?: SkillLinkedFiles;
}

export interface SkillCatalog {
  list(): SkillDescriptor[] | Promise<SkillDescriptor[]>;
  search(query: string, limit?: number): SkillDescriptor[] | Promise<SkillDescriptor[]>;
  load(target: string): LoadedSkill | undefined | Promise<LoadedSkill | undefined>;
  manage?(request: SkillManageRequest): SkillManageResult | Promise<SkillManageResult>;
}

export type SkillManageAction =
  | 'create'
  | 'edit'
  | 'patch'
  | 'delete'
  | 'write_file'
  | 'remove_file';

export interface SkillManageRequest {
  action: SkillManageAction;
  id?: string;
  name?: string;
  content?: string;
  category?: string;
  file_path?: string;
  file_content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

export interface SkillManageResult {
  success: boolean;
  action: SkillManageAction;
  id?: string;
  path?: string;
  file_path?: string;
  created_override?: boolean;
  message?: string;
  error?: string;
}

export interface ProfileDescriptor {
  name: string;
  description?: string;
  dir?: string;
}

export interface ProfileResourcePolicy {
  mode?: 'isolated' | 'profile-first' | 'shared';
  root?: string;
  sharedRoots?: string[];
  compatibilityRoots?: string[];
  enabled?: string[];
  disabled?: string[];
  authoring?: boolean;
}

export interface MemoryProviderInfo {
  id: string;
  title?: string;
  description?: string;
  writable?: boolean;
  path?: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  title?: string;
  tags?: string[];
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult extends MemoryEntry {
  score?: number;
}

export interface MemoryReadRequest {
  id?: string;
  limit?: number;
}

export interface MemoryReadResult {
  entries: MemoryEntry[];
  raw?: string;
}

export interface MemorySearchRequest {
  query: string;
  limit?: number;
}

export interface MemoryAppendRequest {
  content: string;
  title?: string;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
}

export type MemoryManageAction = 'append' | 'patch' | 'delete' | 'replace';

export interface MemoryManageRequest extends MemoryAppendRequest {
  action: MemoryManageAction;
  id?: string;
  old_string?: string;
  new_string?: string;
}

export interface MemoryManageResult {
  success: boolean;
  action: MemoryManageAction;
  id?: string;
  path?: string;
  message?: string;
  error?: string;
}

export interface MemoryProvider {
  info(): MemoryProviderInfo | Promise<MemoryProviderInfo>;
  read(request?: MemoryReadRequest): MemoryReadResult | Promise<MemoryReadResult>;
  search(request: MemorySearchRequest): MemorySearchResult[] | Promise<MemorySearchResult[]>;
  append(request: MemoryAppendRequest): MemoryManageResult | Promise<MemoryManageResult>;
  manage?(request: MemoryManageRequest): MemoryManageResult | Promise<MemoryManageResult>;
}

export interface MemoryAutoCaptureInput {
  userInput: string;
  assistantOutput?: string;
  source?: string;
  tags?: string[];
}

export interface MemoryAutoCapturePolicy {
  enabled?: boolean;
  triggers?: string[];
  maxEntryChars?: number;
  includeAssistant?: boolean;
}

export interface MemoryAutoCaptureDecision {
  capture: boolean;
  /** Stable id of the trigger rule that fired (e.g. 'remember', 'prefer-over'). */
  trigger?: string;
  /**
   * Normalized note content extracted from `userInput`. Set only when
   * `capture === true`. Callers should store this rather than the verbatim
   * input so MEMORY.md doesn't accumulate full chat messages.
   */
  extracted?: string;
  reason?: string;
}

/**
 * Trigger ids enabled by default. Each id corresponds to an entry in
 * `MEMORY_AUTO_CAPTURE_RULES` below — a strict pattern + extractor pair.
 *
 * The previous implementation matched these as plain substrings against
 * the lowercased user input, which fired on incidental phrases ('we
 * should eventually do X', 'I want to figure out Y') and stored the
 * entire verbatim message as a "preference". The new rules are
 * anchored, structurally specific, and produce a normalized extracted
 * note instead of capturing the raw input.
 */
export const DEFAULT_MEMORY_CAPTURE_TRIGGERS = [
  'remember',
  'from-now-on',
  'imperative-always',
  'imperative-never',
  'imperative-dont',
  'prefer-over',
];

/** Reject auto-capture entirely above this length — discussion, not a preference. */
const MEMORY_AUTO_CAPTURE_MAX_INPUT_CHARS = 600;
/** Reject extraction if the extracted note exceeds this; usually means the regex over-grabbed. */
const MEMORY_AUTO_CAPTURE_MAX_EXTRACT_CHARS = 240;

/**
 * Common idioms that start with one of the trigger words but are not
 * preferences. ("never mind", "don't worry", "remember when…") If any
 * pattern matches, the input is rejected before rule evaluation.
 */
const MEMORY_AUTO_CAPTURE_IDIOMS: readonly RegExp[] = [
  /^\s*never mind\b/i,
  /^\s*don'?t worry\b/i,
  /^\s*don'?t (know|think|care|mention|see|get)\b/i,
  /^\s*do not (know|think|care|mention|see|get)\b/i,
  /^\s*remember (when|that time|me|us|how)\b/i,
  /^\s*always glad\b/i,
  /^\s*always welcome\b/i,
];

interface MemoryAutoCaptureRule {
  readonly id: string;
  match(text: string): { extracted: string } | undefined;
}

/**
 * Built-in trigger rules. Each `match()` is anchored — typically to start
 * of message — so casual mid-sentence uses don't fire. Each rule yields
 * a normalized note via the `extracted` field; callers store that, not
 * the raw input.
 */
export const MEMORY_AUTO_CAPTURE_RULES: readonly MemoryAutoCaptureRule[] = [
  {
    id: 'remember',
    match(text) {
      const m = /^\s*remember(?:\s+(?:that|to))?[:,]?\s+(.+?)\s*[.!?]?\s*$/is.exec(text);
      return m ? { extracted: m[1].trim() } : undefined;
    },
  },
  {
    id: 'from-now-on',
    match(text) {
      const m = /^\s*from now on[,:]?\s+(.+?)\s*[.!?]?\s*$/is.exec(text);
      return m ? { extracted: m[1].trim() } : undefined;
    },
  },
  {
    id: 'imperative-always',
    match(text) {
      // Anchored to start so "we should always X" (discussion) doesn't fire.
      const m = /^\s*(?:please\s+)?always\s+(.+?)\s*[.!?]?\s*$/is.exec(text);
      return m ? { extracted: `Always ${m[1].trim()}` } : undefined;
    },
  },
  {
    id: 'imperative-never',
    match(text) {
      const m = /^\s*(?:please\s+)?never\s+(.+?)\s*[.!?]?\s*$/is.exec(text);
      return m ? { extracted: `Never ${m[1].trim()}` } : undefined;
    },
  },
  {
    id: 'imperative-dont',
    match(text) {
      const m = /^\s*(?:please\s+)?(?:don'?t|do not)\s+(.+?)\s*[.!?]?\s*$/is.exec(text);
      return m ? { extracted: `Don't ${m[1].trim()}` } : undefined;
    },
  },
  {
    id: 'prefer-over',
    match(text) {
      // "I prefer X over Y" — structural, not just any 'prefer' substring.
      const m = /\bI\s+prefer\s+(.+?)\s+over\s+(.+?)\s*(?:[.!?]|$)/is.exec(text);
      return m ? { extracted: `Prefer ${m[1].trim()} over ${m[2].trim()}` } : undefined;
    },
  },
];

export interface ParsedSkillMarkdown {
  frontmatter: SkillFrontmatter;
  body: string;
}

export interface SkillCommandMetadata {
  command: string;
  collides: boolean;
  reservedBy?: string;
}

export function parseMarkdownFrontmatter(
  raw: string,
): { frontmatter: Record<string, unknown>; body: string } | undefined {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return undefined;
  const parsed = parseYaml(match[1]) as unknown;
  if (!isRecord(parsed)) return undefined;
  return { frontmatter: parsed, body: match[2] };
}

export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown | undefined {
  const parsed = parseMarkdownFrontmatter(raw);
  if (!parsed) return undefined;
  const frontmatter = normalizeSkillFrontmatter(parsed.frontmatter);
  if (!frontmatter) return undefined;
  return { frontmatter, body: parsed.body.trim() };
}

export function validateSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const parsed = parseMarkdownFrontmatter(raw);
  if (!parsed) throw new Error('SKILL.md must start with YAML frontmatter.');
  const frontmatter = normalizeSkillFrontmatter(parsed.frontmatter);
  if (!frontmatter) {
    throw new Error('SKILL.md frontmatter must include non-empty name and description fields.');
  }
  const body = parsed.body.trim();
  if (!body) throw new Error('SKILL.md must include instructions after the frontmatter.');
  return { frontmatter, body };
}

export function skillDescriptorFromMarkdown(options: {
  id: string;
  raw: string;
  category?: string;
  source?: string;
  sourceRoot?: string;
  writable?: boolean;
  path?: string;
  dir?: string;
}): SkillDescriptor | undefined {
  const parsed = parseSkillMarkdown(options.raw);
  if (!parsed) return undefined;
  return skillDescriptorFromFrontmatter({
    id: options.id,
    frontmatter: parsed.frontmatter,
    category: options.category,
    source: options.source,
    sourceRoot: options.sourceRoot,
    writable: options.writable,
    path: options.path,
    dir: options.dir,
  });
}

export function skillDescriptorFromFrontmatter(options: {
  id: string;
  frontmatter: SkillFrontmatter;
  category?: string;
  source?: string;
  sourceRoot?: string;
  writable?: boolean;
  path?: string;
  dir?: string;
}): SkillDescriptor {
  const tags = normalizeTags(options.frontmatter.tags, options.frontmatter.metadata?.hermes?.tags);
  return {
    id: options.id,
    name: options.frontmatter.name,
    description: options.frontmatter.description,
    command: skillCommandSlug(options.frontmatter.name),
    aliases: normalizeStringList(options.frontmatter.aliases),
    category: options.frontmatter.category ?? options.category ?? categoryForSkillId(options.id),
    tags,
    source: options.source,
    sourceRoot: options.sourceRoot,
    writable: options.writable,
    path: options.path,
    dir: options.dir,
  };
}

export function skillCommandSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `/${slug || 'skill'}`;
}

export function skillCommandMetadata(
  descriptor: Pick<SkillDescriptor, 'command'>,
  reservedCommands: Iterable<string>,
): SkillCommandMetadata {
  const reserved = new Set([...reservedCommands].map((command) => command.toLowerCase()));
  const command = descriptor.command;
  const collides = reserved.has(command.toLowerCase());
  return { command, collides, reservedBy: collides ? command : undefined };
}

export function skillMatchesPlatform(
  frontmatter: Pick<SkillFrontmatter, 'platforms'>,
  platform = currentPlatform(),
): boolean {
  const platforms = normalizeStringList(frontmatter.platforms);
  if (platforms.length === 0) return true;
  const normalized = normalizePlatform(platform);
  return platforms.some((candidate) => normalizePlatform(candidate) === normalized);
}

export function categoryForSkillId(id: string): string {
  const [first, second] = id.split('/');
  return second ? first : 'general';
}

export function normalizeSkillId(id: string): string {
  const parts = id
    .split(/[\\/]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9._-]/g, '')
        .replace(/-+/g, '-'),
    )
    .filter(Boolean);
  if (parts.length === 0) throw new Error('Skill id cannot be empty.');
  return parts.join('/');
}

export function descriptorSummary(descriptor: SkillDescriptor): string {
  return `${descriptor.id} (${descriptor.name}) - ${descriptor.description}`;
}

export function memoryShouldAutoCapture(
  input: MemoryAutoCaptureInput,
  policy: MemoryAutoCapturePolicy = {},
): MemoryAutoCaptureDecision {
  if (policy.enabled === false) return { capture: false, reason: 'disabled' };
  const text = input.userInput.trim();
  if (!text) return { capture: false, reason: 'empty input' };
  if (text.length > MEMORY_AUTO_CAPTURE_MAX_INPUT_CHARS) {
    // Long messages are almost always discussion or troubleshooting context,
    // not a preference. Capturing them pollutes the durable-memory channel
    // with whole conversation turns.
    return { capture: false, reason: 'input too long for auto capture' };
  }
  if (/\n\s*\n/.test(text)) {
    // Multiple paragraphs: again, discussion. Real preferences are short.
    return { capture: false, reason: 'input is multi-paragraph (likely discussion)' };
  }
  for (const idiom of MEMORY_AUTO_CAPTURE_IDIOMS) {
    if (idiom.test(text)) {
      return { capture: false, reason: 'matched idiom denylist' };
    }
  }
  const enabledIds = new Set(
    policy.triggers?.length ? policy.triggers : DEFAULT_MEMORY_CAPTURE_TRIGGERS,
  );
  for (const rule of MEMORY_AUTO_CAPTURE_RULES) {
    if (!enabledIds.has(rule.id)) continue;
    const matched = rule.match(text);
    if (!matched) continue;
    const extracted = matched.extracted.replace(/\s+/g, ' ').trim();
    if (!extracted) continue;
    if (extracted.length > MEMORY_AUTO_CAPTURE_MAX_EXTRACT_CHARS) continue;
    return { capture: true, trigger: rule.id, extracted };
  }
  return { capture: false, reason: 'no trigger matched' };
}

export function formatMemoryMarkdownEntry(
  request: MemoryAppendRequest,
  options: { id?: string; createdAt?: string; maxEntryChars?: number } = {},
): string {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const id = options.id ?? memoryEntryId(createdAt);
  const title = sanitizeMemoryTitle(request.title ?? request.source ?? 'Memory');
  const tags = request.tags?.length ? `\ntags: ${request.tags.join(', ')}` : '';
  const source = request.source ? `\nsource: ${request.source}` : '';
  const content = clampText(request.content.trim(), options.maxEntryChars);
  return [`## ${createdAt} - ${title}`, `id: ${id}${source}${tags}`, '', content, ''].join('\n');
}

export function memoryEntryId(createdAt = new Date().toISOString()): string {
  return createdAt
    .replace(/[^0-9a-z]/gi, '')
    .slice(0, 20)
    .toLowerCase();
}

export function normalizeExtensionId(id: string): string {
  const normalized = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
  if (!normalized) throw new Error('Extension id cannot be empty.');
  return normalized;
}

export function parseExtensionManifest(raw: string): ExtensionManifest | undefined {
  const parsed = parseYaml(raw) as unknown;
  if (!isRecord(parsed)) return undefined;
  const id = typeof parsed.id === 'string' ? normalizeExtensionId(parsed.id) : '';
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  if (!id || !name) return undefined;
  return {
    ...(parsed as unknown as ExtensionManifest),
    id,
    name,
  };
}

export function validateExtensionManifest(raw: string): ExtensionManifest {
  const manifest = parseExtensionManifest(raw);
  if (!manifest) throw new Error('Extension manifest needs non-empty id and name fields.');
  return manifest;
}

function normalizeSkillFrontmatter(value: Record<string, unknown>): SkillFrontmatter | undefined {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (!name || !description) return undefined;
  return { ...value, name, description } as SkillFrontmatter;
}

function sanitizeMemoryTitle(value: string): string {
  const title = value.replace(/\s+/g, ' ').trim();
  return title.length > 80 ? `${title.slice(0, 77)}...` : title || 'Memory';
}

function clampText(value: string, maxEntryChars?: number): string {
  if (!maxEntryChars || value.length <= maxEntryChars) return value;
  return `${value.slice(0, Math.max(0, maxEntryChars - 3)).trimEnd()}...`;
}

function normalizeTags(...values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => normalizeStringList(value)))];
}

export function normalizeStringList(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string')
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function currentPlatform(): string {
  return typeof process === 'undefined' ? 'unknown' : process.platform;
}

function normalizePlatform(platform: string): string {
  const normalized = platform.toLowerCase().trim();
  if (normalized === 'macos') return 'darwin';
  if (normalized === 'windows') return 'win32';
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
