import type { ExistingSessionRow, UpsertSessionArgs } from './session-upsert-types.js';

export function resolveMessageCount(
  existing: ExistingSessionRow | undefined,
  args: UpsertSessionArgs,
): number {
  const baseline = args.replace ? 0 : (existing?.message_count ?? 0);
  return baseline + args.messageDelta;
}
