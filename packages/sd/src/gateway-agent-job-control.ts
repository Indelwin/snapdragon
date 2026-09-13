import type { GatewayClient, GatewayLeaseFence } from '@snapdragon-ai/gateway';
import { safeAppendLog } from './gateway-agent-job-logs.js';

export function monitorJobCancellation(
  client: GatewayClient,
  jobId: string,
  pollMs: number,
  lease?: { fence: GatewayLeaseFence; leaseMs: number },
): {
  readonly signal: AbortSignal;
  readonly cancelled: boolean;
  readonly leaseLost: boolean;
  stop(): void;
} {
  const controller = new AbortController();
  let stopped = false;
  let cancelled = false;
  let leaseLost = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewAt = lease ? Date.now() + Math.max(1, Math.floor(lease.leaseMs / 2)) : undefined;

  const schedule = () => {
    if (stopped || controller.signal.aborted) return;
    const renewalDelay = renewAt === undefined ? pollMs : Math.max(1, renewAt - Date.now());
    timer = setTimeout(tick, Math.max(1, Math.min(pollMs, renewalDelay)));
    timer.unref?.();
  };

  const tick = async () => {
    try {
      if (lease && renewAt !== undefined && Date.now() >= renewAt) {
        const renewed = await client.renewJob(jobId, lease.fence, lease.leaseMs);
        if (!renewed) throw new Error(`gateway job ${jobId} disappeared during lease renewal`);
        renewAt = Date.now() + Math.max(1, Math.floor(lease.leaseMs / 2));
      }
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
      if (lease) {
        leaseLost = true;
        controller.abort(error);
        return;
      }
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
    get leaseLost() {
      return leaseLost;
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
