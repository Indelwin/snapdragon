import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionState } from './input-completion.js';

export function profileSelection(runtime: SdRuntime): PromptCompletionState {
  const profiles = runtime.profileStore.list();
  return {
    mode: 'profile',
    query: '',
    selectedIndex: selectedProfileIndex(profiles, runtime),
    suggestions: [
      {
        label: 'none',
        description: runtime.profile ? 'clear active profile' : 'active',
        insertText: '/profile none',
        kind: 'profile' as const,
      },
      ...profiles.map((profile) => ({
        label: profile.name,
        description: profileDescription(profile, runtime),
        insertText: `/profile ${profile.name}`,
        kind: 'profile' as const,
      })),
    ],
  };
}

function selectedProfileIndex(profiles: Array<{ name: string }>, runtime: SdRuntime): number {
  if (!runtime.profile) return 0;
  const index = profiles.findIndex((profile) => profile.name === runtime.profile?.name);
  return index < 0 ? 0 : index + 1;
}

function profileDescription(
  profile: { name: string; valid: boolean; error?: string; config?: { description?: string } },
  runtime: SdRuntime,
): string {
  if (!profile.valid) return profile.error ?? 'invalid profile';
  const active = profile.name === runtime.profile?.name ? 'active' : '';
  return [active, profile.config?.description ?? 'profile'].filter(Boolean).join(' ');
}
