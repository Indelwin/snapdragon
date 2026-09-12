import type { ExtensionDescriptor } from '@snapdragon-ai/content';
import type { SdConfig } from './config.js';
import { type ExtensionDisposalState, registerExtensionDisposable } from './extension-disposal.js';
import { resolveExtensionPath } from './extension-module.js';
import type {
  SdExtensionActivationContext,
  SdExtensionRuntime,
} from './extension-runtime-types.js';
import type { SdProfileInfo } from './profile.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export function createExtensionContext(
  descriptor: ExtensionDescriptor,
  runtime: SdExtensionRuntime,
  options: {
    config: SdConfig;
    profile?: SdProfileInfo;
    runtimeOptions: SdRuntimeOptions;
    env: NodeJS.ProcessEnv;
  },
  disposal: ExtensionDisposalState,
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
    registerDisposable(disposable) {
      registerExtensionDisposable(disposal, descriptor.id, disposable);
    },
    log(message) {
      runtime.logs.push({ extensionId: descriptor.id, message });
    },
  };
}
