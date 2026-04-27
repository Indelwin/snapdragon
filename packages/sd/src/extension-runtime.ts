import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExtensionDescriptor, MemoryProvider } from '@snapdragon-ai/content';
import type { ProviderModel, ReasoningRequest, StreamingChatHandler } from '@snapdragon-ai/host';
import type { Toolset } from '@snapdragon-ai/tools';
import type { SdConfig, SdProviderConfig, SdProviderKind } from './config.js';
import type { SdExtensionStore } from './extensions.js';
import type { SdProfileInfo } from './profile.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export interface SdExtensionSkillRoot {
  root: string;
  source: 'extension';
  extensionId: string;
  writable?: boolean;
}

export interface SdExtensionProviderCreateOptions {
  id: string;
  model: string;
  kind: SdProviderKind;
  config: SdProviderConfig;
  env: NodeJS.ProcessEnv;
}

export interface SdExtensionProviderRuntime {
  handler: StreamingChatHandler;
  model?: string;
  reasoning?: ReasoningRequest;
}

export interface SdExtensionProviderFactory {
  create(options: SdExtensionProviderCreateOptions): SdExtensionProviderRuntime;
  listModels?(options: Omit<SdExtensionProviderCreateOptions, 'model'>): ProviderModel[];
}

export interface SdExtensionActivationContext {
  descriptor: ExtensionDescriptor;
  config: SdConfig;
  profile?: SdProfileInfo;
  options: SdRuntimeOptions;
  env: NodeJS.ProcessEnv;
  registerToolset(toolset: Toolset): void;
  registerSkillRoot(path: string, options?: { writable?: boolean }): void;
  registerMemoryProvider(id: string, provider: MemoryProvider): void;
  registerProvider(id: string, provider: SdExtensionProviderFactory): void;
  log(message: string): void;
}

export interface SdExtensionModule {
  activate?(context: SdExtensionActivationContext): void | Promise<void>;
}

export interface SdExtensionRuntime {
  toolsets: Toolset[];
  skillRoots: SdExtensionSkillRoot[];
  memoryProviders: Map<string, MemoryProvider>;
  providers: Map<string, SdExtensionProviderFactory>;
  logs: Array<{ extensionId: string; message: string }>;
  errors: Array<{ extensionId: string; message: string }>;
}

export async function activateSdExtensions(options: {
  store: SdExtensionStore;
  config: SdConfig;
  profile?: SdProfileInfo;
  runtimeOptions: SdRuntimeOptions;
  env: NodeJS.ProcessEnv;
}): Promise<SdExtensionRuntime> {
  const runtime = emptyExtensionRuntime();
  for (const descriptor of options.store.enabledList()) {
    collectManifestContributions(runtime, descriptor);
    if (!descriptor.main) continue;
    try {
      const mod = await importExtensionModule(descriptor, options.config.extensions?.hot_reload);
      if (typeof mod.activate === 'function') {
        await mod.activate(extensionContext(descriptor, runtime, options));
      }
    } catch (error) {
      runtime.errors.push({ extensionId: descriptor.id, message: errorMessage(error) });
    }
  }
  return runtime;
}

function emptyExtensionRuntime(): SdExtensionRuntime {
  return {
    toolsets: [],
    skillRoots: [],
    memoryProviders: new Map(),
    providers: new Map(),
    logs: [],
    errors: [],
  };
}

function collectManifestContributions(
  runtime: SdExtensionRuntime,
  descriptor: ExtensionDescriptor,
): void {
  for (const root of descriptor.contributes?.skills ?? []) {
    runtime.skillRoots.push({
      root: resolveExtensionPath(descriptor, root),
      source: 'extension',
      extensionId: descriptor.id,
      writable: false,
    });
  }
}

function extensionContext(
  descriptor: ExtensionDescriptor,
  runtime: SdExtensionRuntime,
  options: {
    config: SdConfig;
    profile?: SdProfileInfo;
    runtimeOptions: SdRuntimeOptions;
    env: NodeJS.ProcessEnv;
  },
): SdExtensionActivationContext {
  return {
    descriptor,
    config: options.config,
    profile: options.profile,
    options: options.runtimeOptions,
    env: options.env,
    registerToolset(toolset) {
      runtime.toolsets.push(toolset);
    },
    registerSkillRoot(path, rootOptions = {}) {
      runtime.skillRoots.push({
        root: resolveExtensionPath(descriptor, path),
        source: 'extension',
        extensionId: descriptor.id,
        writable: rootOptions.writable ?? false,
      });
    },
    registerMemoryProvider(id, provider) {
      runtime.memoryProviders.set(id, provider);
    },
    registerProvider(id, provider) {
      runtime.providers.set(id, provider);
    },
    log(message) {
      runtime.logs.push({ extensionId: descriptor.id, message });
    },
  };
}

async function importExtensionModule(
  descriptor: ExtensionDescriptor,
  hotReload = true,
): Promise<SdExtensionModule> {
  const main = requiredMainPath(descriptor);
  const url = pathToFileURL(main);
  if (hotReload) {
    url.searchParams.set('mtime', String(statSync(main).mtimeMs));
  }
  return (await import(url.href)) as SdExtensionModule;
}

function requiredMainPath(descriptor: ExtensionDescriptor): string {
  if (!descriptor.main) throw new Error(`Extension ${descriptor.id} does not declare main.`);
  const path = resolveExtensionPath(descriptor, descriptor.main);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Extension ${descriptor.id} main not found: ${descriptor.main}`);
  }
  return path;
}

function resolveExtensionPath(descriptor: ExtensionDescriptor, path: string): string {
  if (!descriptor.dir) throw new Error(`Extension ${descriptor.id} has no directory.`);
  const root = resolve(descriptor.dir);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error(`Extension path escapes root: ${path}`);
  }
  return target;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
