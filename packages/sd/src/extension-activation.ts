import type { ExtensionDescriptor } from '@snapdragon-ai/content';
import type { SdConfig } from './config.js';
import { createExtensionContext } from './extension-context.js';
import { type ExtensionDisposalState, registerExtensionDisposable } from './extension-disposal.js';
import { importExtensionModule } from './extension-module.js';
import type { SdExtensionRuntime } from './extension-runtime-types.js';
import type { SdProfileInfo } from './profile.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export async function activateExtensionModule(
  descriptor: ExtensionDescriptor,
  runtime: SdExtensionRuntime,
  options: {
    config: SdConfig;
    profile?: SdProfileInfo;
    runtimeOptions: SdRuntimeOptions;
    env: NodeJS.ProcessEnv;
  },
  disposal: ExtensionDisposalState,
): Promise<void> {
  if (!descriptor.main) return;
  const mod = await importExtensionModule(descriptor);
  if (typeof mod.activate !== 'function') return;
  const context = createExtensionContext(descriptor, runtime, options, disposal);
  if (mod.deactivate) {
    disposal.callbacks.push({
      extensionId: descriptor.id,
      dispose: () => mod.deactivate?.(context),
    });
  }
  const activated = await mod.activate(context);
  if (activated) registerExtensionDisposable(disposal, descriptor.id, activated);
}
