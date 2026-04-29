import { configuredModelsForProvider, listSdProviders } from '../provider.js';
import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionCatalog } from './input-completion.js';

export function providerCompletionCatalog(runtime: SdRuntime): PromptCompletionCatalog {
  return {
    providers: listSdProviders(runtime.config, runtime.provider.id).map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      active: provider.active,
    })),
  };
}

export function modelCompletionCatalog(runtime: SdRuntime): PromptCompletionCatalog {
  return {
    models: configuredModelsForProvider(runtime.config, runtime.provider.id).map((id) => ({
      id,
      active: id === runtime.provider.model,
    })),
  };
}
