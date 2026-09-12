import type { ExtensionDescriptor, ExtensionGatewayServiceManifest } from '@snapdragon-ai/content';
import type { GatewayServiceSpec } from '@snapdragon-ai/gateway';
import type { SdConfig } from './config.js';
import { activateExtensionModule } from './extension-activation.js';
import {
  disposeExtensions,
  type ExtensionDisposalState,
  extensionDisposalState,
} from './extension-disposal.js';
import { resolveExtensionPath } from './extension-module.js';
import type { SdExtensionStore } from './extensions.js';
import type { SdProfileInfo } from './profile.js';

export type {
  SdExtensionActivationContext,
  SdExtensionDisposable,
  SdExtensionModule,
  SdExtensionProviderCreateOptions,
  SdExtensionProviderFactory,
  SdExtensionProviderRuntime,
  SdExtensionRuntime,
  SdExtensionSkillRoot,
} from './extension-runtime-types.js';

import type { SdExtensionRuntime } from './extension-runtime-types.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export async function activateSdExtensions(options: {
  store: SdExtensionStore;
  config: SdConfig;
  profile?: SdProfileInfo;
  runtimeOptions: SdRuntimeOptions;
  env: NodeJS.ProcessEnv;
}): Promise<SdExtensionRuntime> {
  const disposal = extensionDisposalState();
  const runtime = emptyExtensionRuntime(disposal);
  for (const descriptor of options.store.enabledList()) {
    try {
      collectManifestContributions(runtime, descriptor);
      await activateExtensionModule(descriptor, runtime, options, disposal);
    } catch (error) {
      runtime.errors.push({ extensionId: descriptor.id, message: errorMessage(error) });
    }
  }
  return runtime;
}

function emptyExtensionRuntime(disposal: ExtensionDisposalState): SdExtensionRuntime {
  const runtime: SdExtensionRuntime = {
    toolsets: [],
    skillRoots: [],
    memoryProviders: new Map(),
    providers: new Map(),
    gatewayServices: [],
    appliances: [],
    logs: [],
    errors: [],
    dispose: () => disposeExtensions(disposal),
  };
  disposal.errors = runtime.errors;
  return runtime;
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

function gatewayServiceFromManifest(service: ExtensionGatewayServiceManifest): GatewayServiceSpec {
  return {
    name: service.name,
    enabled: service.enabled,
    intervalMs: service.interval_ms,
    startupDelayMs: service.startup_delay_ms,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
