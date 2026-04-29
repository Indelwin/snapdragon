import type { SdRuntime } from '../runtime.js';
import { profileCompletionDescription } from './completion-catalog-profile-description.js';
import type { PromptCompletionCatalog } from './input-completion.js';

export function profileCompletionCatalog(runtime: SdRuntime): PromptCompletionCatalog {
  return {
    profiles: [
      {
        id: 'none',
        active: runtime.profile === undefined,
        description: noneProfileDescription(runtime),
        valid: true,
      },
      ...runtime.profileStore.list().map((profile) => ({
        id: profile.name,
        active: profile.name === activeProfileName(runtime),
        description: profileCompletionDescription(profile),
        valid: profile.valid,
      })),
    ],
  };
}

function activeProfileName(runtime: SdRuntime): string | undefined {
  if (runtime.profile === undefined) return undefined;
  return runtime.profile.name;
}

function noneProfileDescription(runtime: SdRuntime): string {
  if (runtime.profile === undefined) return 'active';
  return 'clear active profile';
}
