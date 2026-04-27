import { parse as parseYaml } from 'yaml';

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
  trigger?: string;
  reason?: string;
}

export interface ExtensionContributionManifest {
  skills?: string[];
  profiles?: string[];
  tools?: string[];
  providers?: string[];
  ui?: string[];
  sandboxes?: string[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  main?: string;
  capabilities?: string[];
  contributes?: ExtensionContributionManifest;
  metadata?: Record<string, unknown>;
}

export interface ExtensionDescriptor extends ExtensionManifest {
  path?: string;
  dir?: string;
  enabled?: boolean;
}

export const DEFAULT_MEMORY_CAPTURE_TRIGGERS = [
  'remember',
  'from now on',
  'always',
  'never',
  'prefer',
  'preference',
  'i want',
  'we should',
  'do not',
  "don't",
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
  const text = input.userInput.toLowerCase();
  const triggers = policy.triggers?.length ? policy.triggers : DEFAULT_MEMORY_CAPTURE_TRIGGERS;
  const trigger = triggers.find((candidate) => text.includes(candidate.toLowerCase()));
  if (!trigger) return { capture: false, reason: 'no trigger matched' };
  return { capture: true, trigger };
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
