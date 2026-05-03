import type { JsonlSession } from '@snapdragon-ai/session';
import type { SdProfileInfo } from './profile.js';
import type { SdProviderRuntime } from './provider.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export function runtimeSessionMeta(
  args: Pick<SdRuntimeOptions, 'cwd'>,
  provider: SdProviderRuntime,
  profile?: SdProfileInfo,
): Record<string, unknown> {
  return {
    app: 'sd',
    provider: provider.id,
    model: provider.model,
    provider_kind: provider.kind,
    cwd: args.cwd,
    profile: profile?.name ?? null,
  };
}

export function ensureRuntimeSessionMeta(
  session: JsonlSession | undefined,
  args: Pick<SdRuntimeOptions, 'cwd'>,
  provider: SdProviderRuntime,
  profile?: SdProfileInfo,
): void {
  if (!session) return;
  const next = runtimeSessionMeta(args, provider, profile);
  if (metadataMatches(session.metadata(), next)) return;
  session.appendMeta(next);
}

function metadataMatches(current: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return Object.entries(next).every(([key, value]) => current[key] === value);
}
