import { type InlineServiceState, runServiceState } from './inline-service-state.js';
import type { GatewayServiceStatus } from './types.js';

export type RunReservation =
  | { status: GatewayServiceStatus }
  | {
      service: InlineServiceState;
      previous: Promise<void>;
      release: () => void;
    };

export function reserveServiceRun(service: InlineServiceState, closed: boolean): RunReservation {
  if (!service.status.enabled || closed) return { status: { ...service.status } };
  let release!: () => void;
  const completed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = service.tail;
  service.tail = previous.then(() => completed);
  return { service, previous, release };
}

export async function executeServiceRun(
  reservation: Exclude<RunReservation, { status: GatewayServiceStatus }>,
  signal?: AbortSignal,
): Promise<GatewayServiceStatus> {
  const { service, previous, release } = reservation;
  await previous;
  if (!service.status.enabled) {
    release();
    return { ...service.status };
  }
  const abort = new AbortController();
  const relayAbort = () => abort.abort(signal?.reason);
  signal?.addEventListener('abort', relayAbort, { once: true });
  if (signal?.aborted) relayAbort();
  service.abort = abort;
  try {
    await runServiceState(service, abort.signal);
  } finally {
    signal?.removeEventListener('abort', relayAbort);
    if (service.abort === abort) service.abort = undefined;
    release();
  }
  return { ...service.status };
}
