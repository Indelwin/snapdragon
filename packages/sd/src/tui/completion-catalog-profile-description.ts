import type { SdRuntime } from '../runtime.js';

type ProfileListEntry = ReturnType<SdRuntime['profileStore']['list']>[number];

export function profileCompletionDescription(profile: ProfileListEntry): string {
  if (!profile.valid) return invalidProfileDescription(profile);
  if (profile.config === undefined) return 'profile';
  if (profile.config.description === undefined) return 'profile';
  return profile.config.description;
}

function invalidProfileDescription(profile: ProfileListEntry): string {
  if (profile.error === undefined) return 'invalid profile';
  return profile.error;
}
