import type { RestRouteResult } from './rest-types.js';
import type { GatewayLeaseFence } from './types.js';

export interface FencedJobBody {
  leaseId?: string;
  attempt?: number;
}

export function fenceFromBody(body: FencedJobBody): GatewayLeaseFence | undefined {
  if (!body.leaseId || !Number.isSafeInteger(body.attempt) || Number(body.attempt) < 1) {
    return undefined;
  }
  return { leaseId: body.leaseId, attempt: Number(body.attempt) };
}

export function missingFence(): RestRouteResult {
  return { status: 400, body: { error: 'leaseId and positive attempt are required' } };
}
