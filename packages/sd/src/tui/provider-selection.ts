import { listSdProviders } from '../provider.js';
import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionState } from './input-completion.js';

export function providerSelection(runtime: SdRuntime): PromptCompletionState {
  const providers = listSdProviders(runtime.config, runtime.provider.id);
  return {
    mode: 'provider',
    query: '',
    selectedIndex: selectedProviderIndex(providers),
    suggestions: providers.map((provider) => ({
      label: provider.id,
      description: providerDescription(provider),
      insertText: `/provider ${provider.id}`,
      kind: 'provider',
    })),
  };
}

function providerDescription(provider: { kind: string; active: boolean; model?: string }): string {
  return [provider.kind, provider.active ? 'active' : '', provider.model ?? '']
    .filter(Boolean)
    .join(' ');
}

function selectedProviderIndex(providers: Array<{ active: boolean }>): number {
  return Math.max(
    0,
    providers.findIndex((provider) => provider.active),
  );
}
