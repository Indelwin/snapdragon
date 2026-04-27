import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type ExtensionDescriptor,
  type ExtensionManifest,
  parseExtensionManifest,
} from '@snapdragon-ai/content';
import { parse as parseYaml } from 'yaml';
import type { SdConfig } from './config.js';
import { DEFAULT_SD_EXTENSION_ROOT } from './config.js';
import type { SdProfileInfo } from './profile.js';

export const EXTENSION_MANIFEST_FILES = [
  'snapdragon.extension.yaml',
  'snapdragon.extension.yml',
  'snapdragon.extension.json',
];

export interface SdExtensionStoreOptions {
  roots: string[];
  enabled?: string[];
  disabled?: string[];
}

export class SdExtensionStore {
  readonly roots: string[];
  readonly enabled?: Set<string>;
  readonly disabled: Set<string>;
  #extensions: ExtensionDescriptor[] = [];

  constructor(options: SdExtensionStoreOptions) {
    this.roots = options.roots;
    this.enabled =
      options.enabled && options.enabled.length > 0 ? new Set(options.enabled) : undefined;
    this.disabled = new Set(options.disabled ?? []);
    this.reload();
  }

  reload(): void {
    const byId = new Map<string, ExtensionDescriptor>();
    for (const root of this.roots) {
      for (const extension of scanExtensionRoot(root)) {
        if (!byId.has(extension.id)) byId.set(extension.id, extension);
      }
    }
    this.#extensions = [...byId.values()]
      .map((extension) => ({ ...extension, enabled: this.#isEnabled(extension) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  list(): ExtensionDescriptor[] {
    return this.#extensions.map((extension) => ({ ...extension }));
  }

  enabledList(): ExtensionDescriptor[] {
    return this.list().filter((extension) => extension.enabled);
  }

  #isEnabled(extension: ExtensionDescriptor): boolean {
    if (this.disabled.has(extension.id) || this.disabled.has(extension.name)) return false;
    if (!this.enabled) return true;
    return this.enabled.has(extension.id) || this.enabled.has(extension.name);
  }
}

export function createSdExtensionStore(
  config: SdConfig,
  profile?: SdProfileInfo,
): SdExtensionStore {
  return new SdExtensionStore({
    roots: resolveSdExtensionRoots(config, profile),
    enabled: config.extensions?.enabled,
    disabled: config.extensions?.disabled,
  });
}

export function resolveSdExtensionRoots(config: SdConfig, profile?: SdProfileInfo): string[] {
  const roots = config.extensions?.roots ?? [DEFAULT_SD_EXTENSION_ROOT];
  const withProfile = profile?.dir ? [join(profile.dir, 'extensions'), ...roots] : roots;
  return [...new Set(withProfile.map((root) => resolveHome(root)))];
}

function scanExtensionRoot(root: string): ExtensionDescriptor[] {
  if (!existsSync(root)) return [];
  const extensions: ExtensionDescriptor[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(root, entry.name);
    const manifest = readExtensionManifest(dir);
    if (manifest) extensions.push({ ...manifest, dir, path: manifestPath(dir) });
  }
  const rootManifest = readExtensionManifest(root);
  if (rootManifest) extensions.push({ ...rootManifest, dir: root, path: manifestPath(root) });
  return extensions;
}

function readExtensionManifest(dir: string): ExtensionManifest | undefined {
  const path = manifestPath(dir);
  if (!path || !statSync(path).isFile()) return undefined;
  const raw = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) {
    return parseExtensionManifest(JSON.stringify(JSON.parse(raw)));
  }
  return parseExtensionManifest(JSON.stringify(parseYaml(raw)));
}

function manifestPath(dir: string): string | undefined {
  return EXTENSION_MANIFEST_FILES.map((file) => join(dir, file)).find((path) => existsSync(path));
}

function resolveHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return resolve(path);
}
