import type { GatewayClient, GatewayJobStatus, GatewayLeaseFence } from '@snapdragon-ai/gateway';
import { isJobCancelled, safeJobStatus } from './gateway-job-status.js';

interface LeaseMonitorState {
  readonly cancelled: boolean;
  readonly leaseLost: boolean;
}

export interface LearnJobFailure {
  cancelled: boolean;
  message: string;
}

export async function settleLearnJobFailure(
  client: GatewayClient,
  job: GatewayJobStatus,
  fence: GatewayLeaseFence,
  monitor: LeaseMonitorState,
  error: unknown,
): Promise<LearnJobFailure> {
  let message = error instanceof Error ? error.message : String(error);
  if (monitor.cancelled || (await isJobCancelled(client, job.id))) {
    return { cancelled: true, message };
  }
  const current = await safeJobStatus(client, job.id);
  if (!monitor.leaseLost && current?.state === 'running') {
    try {
      await client.failJob(job.id, message, fence);
    } catch (failure) {
      if ((await safeJobStatus(client, job.id))?.state === 'cancelled') {
        return { cancelled: true, message };
      }
      const failureMessage = failure instanceof Error ? failure.message : String(failure);
      message = `${message}; failure update not applied: ${failureMessage}`;
    }
  }
  return { cancelled: false, message };
}
