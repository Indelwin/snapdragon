import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExtensionDescriptor, ExtensionGatewayServiceManifest } from '@snapdragon-ai/content';
import type { GatewayServiceSpec } from '@snapdragon-ai/gateway';
import type { SdConfig } from './config.js';
import type { SdExtensionStore } from './extensions.js';
import type { SdProfileInfo } from './profile.js';

export type {
  SdExtensionActivationContext,
  SdExtensionModule,
  SdExtensionProviderCreateOptions,
  SdExtensionProviderFactory,
  SdExtensionProviderRuntime,
  SdExtensionRuntime,
  SdExtensionSkillRoot,
} from './extension-runtime-types.js';

import type {
  SdExtensionActivationContext,
  SdExtensionModule,
  SdExtensionRuntime,
} from './extension-runtime-types.js';
import type { SdRuntimeOptions } from './runtime-options.js';

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
    gatewayServices: [],
    appliances: [],
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
  for (const service of descriptor.contributes?.gateway?.services ?? []) {
    runtime.gatewayServices.push(gatewayServiceFromManifest(service));
  }
  for (const appliance of descriptor.contributes?.appliances ?? []) {
    runtime.appliances.push({ ...appliance });
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
    registerGatewayService(service) {
      runtime.gatewayServices.push(service);
    },
    registerAppliance(appliance) {
      runtime.appliances.push({ ...appliance });
    },
    log(message) {
      runtime.logs.push({ extensionId: descriptor.id, message });
    },
  };
}

function gatewayServiceFromManifest(service: ExtensionGatewayServiceManifest): GatewayServiceSpec {
  return {
    name: service.name,
    enabled: service.enabled,
    intervalMs: service.interval_ms,
    startupDelayMs: service.startup_delay_ms,
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
