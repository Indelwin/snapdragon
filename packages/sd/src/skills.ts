import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  categoryForSkillId,
  type LoadedSkill,
  normalizeSkillId,
  parseSkillMarkdown,
  type SkillCatalog,
  type SkillDescriptor,
  type SkillLinkedFiles,
  type SkillManageRequest,
  type SkillManageResult,
  skillDescriptorFromFrontmatter,
  skillMatchesPlatform,
  validateSkillMarkdown,
} from '@snapdragon-ai/content';
import type { SdConfig } from './config.js';
import type { SdProfileInfo } from './profile.js';

export const DEFAULT_SD_SKILL_ROOT = resolve(homedir(), '.snapdragon/sd/skills');
export const SKILL_FILE = 'SKILL.md';
const ALLOWED_SUPPORT_DIRS = new Set(['references', 'templates', 'scripts', 'assets']);

export interface SdSkillRoot {
  root: string;
  writable: boolean;
  source: 'profile' | 'sd' | 'shared' | 'compat';
}

export interface SdSkillStoreOptions {
  roots: SdSkillRoot[];
  enabled?: string[];
  disabled?: string[];
}

export interface SkillInvocation {
  visibleInput: string;
  requestInput: string;
  meta: Record<string, unknown>;
}

interface IndexedSkill extends SkillDescriptor {
  frontmatter: LoadedSkill['frontmatter'];
  body: string;
  raw: string;
  linkedFiles?: SkillLinkedFiles;
}

export class SdSkillStore implements SkillCatalog {
  readonly roots: SdSkillRoot[];
  readonly enabled?: Set<string>;
  readonly disabled: Set<string>;
  #skills: IndexedSkill[] = [];

  constructor(options: SdSkillStoreOptions) {
    this.roots = options.roots;
    this.enabled =
      options.enabled && options.enabled.length > 0 ? new Set(options.enabled) : undefined;
    this.disabled = new Set(options.disabled ?? []);
    this.reload();
  }

  reload(): void {
    const byId = new Map<string, IndexedSkill>();
    for (const root of this.roots) {
      if (root.writable) mkdirSync(root.root, { recursive: true });
      for (const skill of scanRoot(root)) {
        if (!byId.has(skill.id)) byId.set(skill.id, skill);
      }
    }
    this.#skills = [...byId.values()]
      .filter((skill) => this.#filter(skill))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  list(): SkillDescriptor[] {
    return this.#skills.map(toDescriptor);
  }

  search(query: string, limit = 10): SkillDescriptor[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return this.list().slice(0, limit);
    return this.#skills
      .map((skill) => ({ skill, score: scoreSkill(skill, words) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
      .slice(0, limit)
      .map((entry) => toDescriptor(entry.skill));
  }

  load(target: string): LoadedSkill | undefined {
    const skill = this.#resolve(target);
    return skill ? { ...skill } : undefined;
  }

  manage(request: SkillManageRequest): SkillManageResult {
    try {
      const result = this.#manage(request);
      this.reload();
      return result;
    } catch (error) {
      return {
        success: false,
        action: request.action,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  #manage(request: SkillManageRequest): SkillManageResult {
    if (request.action === 'create') return this.#create(request);
    if (request.action === 'edit') return this.#edit(request);
    if (request.action === 'patch') return this.#patch(request);
    if (request.action === 'delete') return this.#delete(request);
    if (request.action === 'write_file') return this.#writeFile(request);
    if (request.action === 'remove_file') return this.#removeFile(request);
    return { success: false, action: request.action, error: `Unknown action: ${request.action}` };
  }

  #create(request: SkillManageRequest): SkillManageResult {
    const content = requiredString(request.content, 'content');
    const parsed = validateSkillMarkdown(content);
    const id = normalizeSkillId(
      request.id ??
        [request.category, request.name ?? parsed.frontmatter.name].filter(Boolean).join('/'),
    );
    if (this.#resolve(id)) throw new Error(`Skill already exists: ${id}`);
    const root = this.#writableRoot();
    const dir = safeSkillDir(root.root, id);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, SKILL_FILE);
    atomicWrite(path, normalizeFile(content));
    return { success: true, action: 'create', id, path, message: `Created skill ${id}.` };
  }

  #edit(request: SkillManageRequest): SkillManageResult {
    const content = requiredString(request.content, 'content');
    validateSkillMarkdown(content);
    const skill = this.#writableSkill(request);
    atomicWrite(requiredPath(skill.path), normalizeFile(content));
    return {
      success: true,
      action: 'edit',
      id: skill.id,
      path: skill.path,
      message: `Updated skill ${skill.id}.`,
    };
  }

  #patch(request: SkillManageRequest): SkillManageResult {
    const skill = this.#writableSkill(request);
    const target = request.file_path
      ? resolveManagedFile(requiredDir(skill.dir), request.file_path, false)
      : requiredPath(skill.path);
    const oldString = requiredString(request.old_string, 'old_string');
    const newString = request.new_string ?? '';
    const original = readFileSync(target, 'utf8');
    if (!original.includes(oldString)) throw new Error('old_string not found.');
    if (!request.replace_all && original.indexOf(oldString) !== original.lastIndexOf(oldString)) {
      throw new Error('old_string matched multiple locations; set replace_all=true.');
    }
    const next = request.replace_all
      ? original.split(oldString).join(newString)
      : original.replace(oldString, newString);
    if (!request.file_path) validateSkillMarkdown(next);
    atomicWrite(target, normalizeFile(next));
    return {
      success: true,
      action: 'patch',
      id: skill.id,
      path: target,
      message: `Patched skill ${skill.id}.`,
    };
  }

  #delete(request: SkillManageRequest): SkillManageResult {
    const skill = this.#writableSkill(request);
    rmSync(requiredDir(skill.dir), { recursive: true, force: true });
    return { success: true, action: 'delete', id: skill.id, message: `Deleted skill ${skill.id}.` };
  }

  #writeFile(request: SkillManageRequest): SkillManageResult {
    const skill = this.#writableSkill(request);
    const target = resolveManagedFile(
      requiredDir(skill.dir),
      requiredString(request.file_path, 'file_path'),
      true,
    );
    atomicWrite(target, request.file_content ?? '');
    return {
      success: true,
      action: 'write_file',
      id: skill.id,
      file_path: relative(requiredDir(skill.dir), target),
      path: target,
      message: `Wrote ${relative(requiredDir(skill.dir), target)} in skill ${skill.id}.`,
    };
  }

  #removeFile(request: SkillManageRequest): SkillManageResult {
    const skill = this.#writableSkill(request);
    const target = resolveManagedFile(
      requiredDir(skill.dir),
      requiredString(request.file_path, 'file_path'),
      false,
    );
    rmSync(target, { force: true });
    return {
      success: true,
      action: 'remove_file',
      id: skill.id,
      file_path: relative(requiredDir(skill.dir), target),
      message: `Removed ${relative(requiredDir(skill.dir), target)} from skill ${skill.id}.`,
    };
  }

  #writableRoot(): SdSkillRoot {
    const root = this.roots.find((candidate) => candidate.writable);
    if (!root) throw new Error('No writable skill root is configured.');
    return root;
  }

  #writableSkill(request: SkillManageRequest): IndexedSkill {
    const target = request.id ?? request.name;
    if (!target) throw new Error('id or name is required.');
    const skill = this.#resolve(target);
    if (!skill) throw new Error(`Skill not found: ${target}`);
    if (!skill.writable) throw new Error(`Skill is read-only: ${skill.id}`);
    return skill;
  }

  #resolve(target: string): IndexedSkill | undefined {
    const normalized = target.trim();
    if (!normalized) return undefined;
    const command = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return this.#skills.find((skill) => {
      return (
        skill.id === normalized ||
        skill.name === normalized ||
        skill.command === command ||
        skill.command.slice(1) === normalized ||
        skill.aliases.includes(normalized)
      );
    });
  }

  #filter(skill: IndexedSkill): boolean {
    if (this.disabled.has(skill.id) || this.disabled.has(skill.name)) return false;
    if (!this.enabled) return true;
    return this.enabled.has(skill.id) || this.enabled.has(skill.name);
  }
}

export function createSdSkillStore(config: SdConfig, profile?: SdProfileInfo): SdSkillStore {
  return new SdSkillStore({
    roots: resolveSdSkillRoots(config, profile),
    enabled: config.skills?.enabled,
    disabled: config.skills?.disabled,
  });
}

export function resolveSdSkillRoots(config: SdConfig, profile?: SdProfileInfo): SdSkillRoot[] {
  const roots: SdSkillRoot[] = [];
  if (profile) {
    roots.push({ root: join(profile.dir, 'skills'), writable: true, source: 'profile' });
  } else {
    roots.push({
      root: config.skills?.root ? resolve(config.skills.root) : DEFAULT_SD_SKILL_ROOT,
      writable: true,
      source: 'sd',
    });
  }
  for (const root of config.skills?.shared_roots ?? []) {
    roots.push({ root: resolve(root), writable: false, source: 'shared' });
  }
  for (const root of config.skills?.compatibility_roots ?? []) {
    roots.push({ root: resolve(root), writable: false, source: 'compat' });
  }
  return roots;
}

export function skillForSlashCommand(
  store: SdSkillStore,
  command: string,
  reservedCommands: Iterable<string>,
): SkillDescriptor | undefined {
  const reserved = new Set([...reservedCommands].map((item) => item.toLowerCase()));
  if (reserved.has(command.toLowerCase())) return undefined;
  return store.list().find((skill) => skill.command === command);
}

export function buildSkillInvocation(
  skill: LoadedSkill,
  visibleInput: string,
  task: string,
): SkillInvocation {
  const requestInput = [
    `[SYSTEM: The user invoked the "${skill.name}" skill. Follow the loaded skill instructions for this request only.]`,
    '',
    `Skill id: ${skill.id}`,
    `Skill name: ${skill.name}`,
    `Skill description: ${skill.description}`,
    skill.dir ? `Skill directory: ${skill.dir}` : undefined,
    '',
    skill.body,
    '',
    supportingFilesBlock(skill),
    task ? `User task: ${task}` : 'User task: Run this skill.',
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n');
  return {
    visibleInput,
    requestInput,
    meta: {
      skill_invocation: {
        id: skill.id,
        name: skill.name,
        command: skill.command,
        path: skill.path,
        dir: skill.dir,
        sha256: sha256(skill.raw),
      },
    },
  };
}

function scanRoot(root: SdSkillRoot): IndexedSkill[] {
  if (!existsSync(root.root)) return [];
  const skills: IndexedSkill[] = [];
  walk(root.root, (dir) => {
    const path = join(dir, SKILL_FILE);
    if (!existsSync(path)) return false;
    const raw = readFileSync(path, 'utf8');
    const parsed = parseSkillMarkdown(raw);
    if (!parsed || !skillMatchesPlatform(parsed.frontmatter)) return false;
    const id = normalizeSkillId(relative(root.root, dir) || parsed.frontmatter.name);
    const descriptor = skillDescriptorFromFrontmatter({
      id,
      frontmatter: parsed.frontmatter,
      category: categoryForSkillId(id),
      source: root.source,
      sourceRoot: root.root,
      writable: root.writable,
      path,
      dir,
    });
    skills.push({
      ...descriptor,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      raw,
      linkedFiles: collectLinkedFiles(dir),
    });
    return true;
  });
  return skills;
}

function walk(dir: string, visit: (dir: string) => boolean): void {
  if (visit(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    walk(join(dir, entry.name), visit);
  }
}

function collectLinkedFiles(skillDir: string): SkillLinkedFiles {
  const out: SkillLinkedFiles = {};
  for (const subdir of ALLOWED_SUPPORT_DIRS) {
    const dir = join(skillDir, subdir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const files = listFiles(dir).map((file) => relative(dir, file));
    if (files.length > 0) out[subdir as keyof SkillLinkedFiles] = files;
  }
  return out;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function toDescriptor(skill: IndexedSkill): SkillDescriptor {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    command: skill.command,
    aliases: skill.aliases,
    category: skill.category,
    tags: skill.tags,
    source: skill.source,
    sourceRoot: skill.sourceRoot,
    writable: skill.writable,
    path: skill.path,
    dir: skill.dir,
  };
}

function scoreSkill(skill: IndexedSkill, words: string[]): number {
  const haystack = [
    skill.id,
    skill.name,
    skill.description,
    skill.category,
    skill.command,
    ...skill.aliases,
    ...skill.tags,
  ]
    .join(' ')
    .toLowerCase();
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

function safeSkillDir(root: string, id: string): string {
  return resolveInside(root, id);
}

function resolveManagedFile(skillDir: string, filePath: string, createParent: boolean): string {
  if (isAbsolute(filePath)) throw new Error('Supporting file path must be relative.');
  const [first] = filePath.split(/[\\/]/);
  if (!first || !ALLOWED_SUPPORT_DIRS.has(first)) {
    throw new Error(
      'Supporting file path must start with references, templates, scripts, or assets.',
    );
  }
  const target = resolveInside(skillDir, filePath);
  if (createParent) mkdirSync(dirname(target), { recursive: true });
  if (!createParent && !existsSync(target)) throw new Error(`File not found: ${filePath}`);
  return target;
}

function resolveInside(root: string, path: string): string {
  const rootPath = resolve(root);
  const target = resolve(rootPath, path);
  const rel = relative(rootPath, target);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error(`Path escapes skill root: ${path}`);
  }
  return target;
}

function requiredString(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function requiredPath(value: string | undefined): string {
  if (!value) throw new Error('Skill path is unavailable.');
  return value;
}

function requiredDir(value: string | undefined): string {
  if (!value) throw new Error('Skill directory is unavailable.');
  return value;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'snapdragon-skill-'));
  const temp = join(tempDir, 'write.tmp');
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, path);
  rmSync(tempDir, { recursive: true, force: true });
}

function normalizeFile(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function supportingFilesBlock(skill: LoadedSkill): string {
  const lines = linkedFileEntries(skill.linkedFiles).map(
    ([kind, file]) => `- ${kind}/${file} -> ${skill.dir ? join(skill.dir, kind, file) : file}`,
  );
  return lines.length ? ['Supporting files:', ...lines].join('\n') : '';
}

function linkedFileEntries(linked: SkillLinkedFiles | undefined): Array<[string, string]> {
  if (!linked) return [];
  return [
    ...(linked.references ?? []).map((file): [string, string] => ['references', file]),
    ...(linked.templates ?? []).map((file): [string, string] => ['templates', file]),
    ...(linked.scripts ?? []).map((file): [string, string] => ['scripts', file]),
    ...(linked.assets ?? []).map((file): [string, string] => ['assets', file]),
  ];
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
