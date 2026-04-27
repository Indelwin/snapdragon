import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SdAgentConfig, SdSkillsConfig, SdToolsetsConfig } from './config.js';

export const DEFAULT_SD_PROFILE_ROOT = resolve(homedir(), '.snapdragon/sd/profiles');
export const ACTIVE_PROFILE_FILE = '_active';

export interface SdProfileConfig {
  name: string;
  description?: string;
  persona?: string;
  persona_inline?: string;
  model?: {
    provider?: string;
    name?: string;
  };
  agent?: SdAgentConfig;
  toolsets?: SdToolsetsConfig;
  skills?: Omit<SdSkillsConfig, 'root'>;
}

export interface SdProfileInfo {
  name: string;
  dir: string;
  configPath: string;
  valid: boolean;
  active?: boolean;
  config?: SdProfileConfig;
  persona?: string;
  error?: string;
}

export interface SdProfileStoreOptions {
  root?: string;
}

export class SdProfileStore {
  readonly root: string;

  constructor(options: SdProfileStoreOptions = {}) {
    this.root = options.root ?? DEFAULT_SD_PROFILE_ROOT;
    mkdirSync(this.root, { recursive: true });
  }

  activeName(): string | undefined {
    const path = this.activePath();
    if (!existsSync(path)) return undefined;
    const value = readFileSync(path, 'utf8').trim();
    return value.length > 0 ? value : undefined;
  }

  setActiveName(name: string | null): void {
    if (name === null) {
      writeFileSync(this.activePath(), '', 'utf8');
      return;
    }
    assertValidProfileName(name);
    writeFileSync(this.activePath(), `${name}\n`, 'utf8');
  }

  list(): SdProfileInfo[] {
    const active = this.activeName();
    return readdirSync(this.root)
      .filter((entry) => entry !== ACTIVE_PROFILE_FILE)
      .filter((entry) => isProfileDirectory(join(this.root, entry)))
      .map((name) => this.loadInfo(name, { active }))
      .sort(compareProfiles);
  }

  load(name: string): SdProfileInfo {
    const info = this.loadInfo(name, { active: this.activeName() });
    if (!info.valid) throw new Error(info.error ?? `Profile '${name}' is invalid`);
    return info;
  }

  create(name: string, config: Partial<Omit<SdProfileConfig, 'name'>> = {}): SdProfileInfo {
    assertValidProfileName(name);
    const dir = this.profileDir(name);
    const configPath = join(dir, 'profile.yaml');
    if (existsSync(configPath)) throw new Error(`Profile '${name}' already exists`);
    mkdirSync(dir, { recursive: true });
    const profileConfig: SdProfileConfig = {
      name,
      description: config.description,
      persona: config.persona_inline ? undefined : (config.persona ?? 'SOUL.md'),
      persona_inline: config.persona_inline,
      model: config.model,
      agent: config.agent,
      toolsets: config.toolsets,
      skills: config.skills,
    };
    writeFileSync(configPath, stringifyYaml(stripUndefined(profileConfig)), 'utf8');
    if (!profileConfig.persona_inline) {
      writeFileSync(
        join(dir, profileConfig.persona ?? 'SOUL.md'),
        `# ${name}\n\nDescribe this profile's role, style, and constraints.\n`,
        'utf8',
      );
    }
    ensureProfileHome(dir);
    return this.load(name);
  }

  loadInfo(name: string, options: { active?: string } = {}): SdProfileInfo {
    try {
      assertValidProfileName(name);
      const dir = this.profileDir(name);
      const configPath = join(dir, 'profile.yaml');
      if (!existsSync(configPath)) {
        return invalidInfo(name, dir, configPath, `Profile '${name}' is missing profile.yaml`);
      }
      const config = loadProfileConfig(configPath);
      if (config.name !== name) {
        throw new Error(`Profile '${name}' has mismatched name '${config.name}'`);
      }
      ensureProfileHome(dir);
      const persona = loadProfilePersona(config, dir);
      return {
        name,
        dir,
        configPath,
        valid: true,
        active: options.active === name,
        config,
        persona,
      };
    } catch (error) {
      const dir = this.profileDirUnchecked(name);
      return invalidInfo(name, dir, join(dir, 'profile.yaml'), errorMessage(error));
    }
  }

  profileDir(name: string): string {
    assertValidProfileName(name);
    return this.profileDirUnchecked(name);
  }

  private profileDirUnchecked(name: string): string {
    return join(this.root, name);
  }

  private activePath(): string {
    return join(this.root, ACTIVE_PROFILE_FILE);
  }
}

export function ensureProfileHome(dir: string): void {
  for (const child of ['skills', 'sessions', 'workspace', 'logs', 'home']) {
    mkdirSync(join(dir, child), { recursive: true });
  }
}

export function loadProfilePersona(config: SdProfileConfig, dir: string): string | undefined {
  const inline = trimmed(config.persona_inline);
  if (inline) return inline;
  const persona = trimmed(config.persona);
  if (persona) return personaFromField(persona, dir);
  const soulPath = join(dir, 'SOUL.md');
  if (existsSync(soulPath)) return readFileSync(soulPath, 'utf8').trim();
  return undefined;
}

export function assertValidProfileName(name: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) {
    throw new Error(`Invalid profile name '${name}'`);
  }
}

function loadProfileConfig(path: string): SdProfileConfig {
  const parsed = parseYaml(readFileSync(path, 'utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error(`Profile at ${path} must be a YAML object`);
  const name = parsed.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`Profile at ${path} needs a name`);
  }
  assertValidProfileName(name);
  return parsed as unknown as SdProfileConfig;
}

function personaFromField(persona: string, dir: string): string {
  const path = isAbsolute(persona) ? persona : resolve(dir, persona);
  if (existsSync(path) && statSync(path).isFile()) return readFileSync(path, 'utf8').trim();
  return persona;
}

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function isProfileDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function invalidInfo(name: string, dir: string, configPath: string, error: string): SdProfileInfo {
  return { name, dir, configPath, valid: false, error };
}

function compareProfiles(a: SdProfileInfo, b: SdProfileInfo): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripUndefined<T>(value: T): T {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)]),
  ) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
