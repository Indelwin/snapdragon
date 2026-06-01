import type { GatewayClient } from '@snapdragon-ai/gateway';
import { safeAppendLog } from './gateway-agent-job-logs.js';

export function monitorJobCancellation(
  client: GatewayClient,
  jobId: string,
  pollMs: number,
): { readonly signal: AbortSignal; readonly cancelled: boolean; stop(): void } {
  const controller = new AbortController();
  let stopped = false;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (stopped || controller.signal.aborted) return;
    timer = setTimeout(tick, pollMs);
    timer.unref?.();
  };

  const tick = async () => {
    try {
      if ((await client.showJob(jobId))?.state === 'cancelled') {
        cancelled = true;
        await safeAppendLog(client, {
          level: 'warn',
          target: jobId,
          message: 'job cancellation observed',
        });
        controller.abort(new Error(`gateway job ${jobId} cancelled`));
        return;
      }
    } catch (error) {
      await safeAppendLog(client, {
        level: 'warn',
        target: jobId,
        message: 'job cancellation poll failed',
        data: { error: error instanceof Error ? error.message : String(error) },
      });
    }
    schedule();
  };

  schedule();
  return {
    get signal() {
      return controller.signal;
    },
    get cancelled() {
      return cancelled;
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export async function isJobCancelled(client: GatewayClient, jobId: string): Promise<boolean> {
  try {
    return (await client.showJob(jobId))?.state === 'cancelled';
  } catch {
    return false;
  }
}
