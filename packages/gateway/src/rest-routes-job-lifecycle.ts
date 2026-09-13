import { completeJob, failJob } from './rest-routes-job-finish.js';
import { acquireJob, renewJob } from './rest-routes-job-lease.js';
import type { RestRequest, RestRoute, RestRouteResult } from './rest-types.js';
import type { GatewayClient } from './types.js';

export async function dispatchJobLifecycle(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult | undefined> {
  if (route.method !== 'POST') return undefined;
  const [, id, action] = route.parts;
  if (id === 'acquire' && !action) return acquireJob(client, request);
  if (id && action === 'renew') return renewJob(client, id, request);
  if (id && action === 'complete') return completeJob(client, id, request);
  if (id && action === 'fail') return failJob(client, id, request);
  return undefined;
}
