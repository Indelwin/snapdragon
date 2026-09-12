import type { GatewayEnvelope, GatewayReceiveFilter } from './types.js';

export function matchesMailboxFilter(
  envelope: GatewayEnvelope,
  filter: GatewayReceiveFilter,
): boolean {
  if (filter.kind !== undefined && filter.kind !== envelope.kind) return false;
  if (filter.source !== undefined && filter.source.id !== envelope.source?.id) return false;
  if (filter.correlationId !== undefined && filter.correlationId !== envelope.correlationId) {
    return false;
  }
  if (filter.capability !== undefined && filter.capability !== envelope.capability) return false;
  return true;
}
