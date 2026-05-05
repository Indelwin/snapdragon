import { rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  SdGatewayChannelEventClaim,
  SdGatewayChannelEventResult,
  SdGatewayChannelEventState,
} from './gateway-events-types.js';

export async function completeGatewayChannelEvent(
  claim: SdGatewayChannelEventClaim,
  result: SdGatewayChannelEventResult,
  nowMs: number,
): Promise<'completed' | 'requeued'> {
  if (claim.event.type === 'periodic' && result.status === 'done') {
    await requeuePeriodicEvent(claim, result, nowMs);
    return 'requeued';
  }
  await completeNonPeriodicEvent(claim, result);
  return 'completed';
}

async function completeNonPeriodicEvent(
  claim: SdGatewayChannelEventClaim,
  result: SdGatewayChannelEventResult,
): Promise<void> {
  const state: SdGatewayChannelEventState = result.status === 'done' ? 'done' : 'failed';
  await writeJson(donePathFromClaim(claim, state), { ...claim.event, result });
  await rm(claim.running_path, { force: true });
}

async function requeuePeriodicEvent(
  claim: SdGatewayChannelEventClaim,
  result: SdGatewayChannelEventResult,
  nowMs: number,
): Promise<void> {
  const interval = positiveInterval(claim.event.interval_ms);
  if (!interval) return completeFailedPeriodic(claim, result);
  await writeJson(claim.pending_path, {
    ...claim.event,
    next_at: new Date(nowMs + interval).toISOString(),
    last_result: result,
  });
  await rm(claim.running_path, { force: true });
}

async function completeFailedPeriodic(
  claim: SdGatewayChannelEventClaim,
  result: SdGatewayChannelEventResult,
): Promise<void> {
  await writeJson(donePathFromClaim(claim, 'failed'), {
    ...claim.event,
    result: failedPeriodicResult(result),
  });
  await rm(claim.running_path, { force: true });
}

function failedPeriodicResult(result: SdGatewayChannelEventResult): SdGatewayChannelEventResult {
  return {
    ...result,
    status: 'failed',
    error: result.error ?? 'periodic event missing interval_ms',
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function donePathFromClaim(claim: SdGatewayChannelEventClaim, state: 'done' | 'failed'): string {
  return join(dirname(dirname(claim.pending_path)), state, basename(claim.pending_path));
}

function positiveInterval(value: number | undefined): number | undefined {
  return value && Number.isFinite(value) && value > 0 ? value : undefined;
}
