import type { GatewayAgentRunSpec, GatewayClient, GatewayJobStatus } from '@snapdragon-ai/gateway';
import type { SdBackgroundService, SdBackgroundServiceResult } from './background.js';
import type { SdConfig } from './config-schema.js';
import { runGatewayAgentRuntime } from './gateway-agent-dispatch.js';
import { isJobCancelled, monitorJobCancellation } from './gateway-agent-job-control.js';
import { appendRuntimeEventLog, safeAppendLog } from './gateway-agent-job-logs.js';
import { registerSavedAgentRuntime } from './gateway-agent-runtime-resolve.js';
import { rustGatewayClientForConfig } from './gateway-command-client.js';

const DEFAULT_CANCELLATION_POLL_MS = 1_000;

export interface GatewayAgentJobRunOptions {
  cancellationPollMs?: number;
}

export function gatewayAgentJobService(): SdBackgroundService {
  return {
    name: 'agent-jobs',
    enabled: (ctx) => ctx.config.gateway?.services?.['agent-jobs']?.enabled !== false,
    intervalMs: (ctx) => ctx.config.gateway?.services?.['agent-jobs']?.interval_ms ?? 30_000,
    startupDelayMs: (ctx) =>
      ctx.config.gateway?.services?.['agent-jobs']?.startup_delay_ms ?? 1_000,
    async runOnce(ctx): Promise<SdBackgroundServiceResult> {
      const client = rustGatewayClientForConfig(ctx.config);
      const lease = await client.acquireJob('default', `agent-jobs-${process.pid}`);
      if (!lease) return summary(0, 0, 'no queued agent jobs');
      if (lease.job.spec.kind !== 'agent.run') {
        await client.failJob(lease.job.id, `unsupported job kind: ${lease.job.spec.kind}`);
        return summary(0, 1, `unsupported job ${lease.job.id}`);
      }
      return runGatewayAgentJob(client, ctx.config, lease.job);
    },
  };
}

export async function runGatewayAgentJob(
  client: GatewayClient,
  config: SdConfig,
  job: GatewayJobStatus,
  options: GatewayAgentJobRunOptions = {},
): Promise<SdBackgroundServiceResult> {
  const monitor = monitorJobCancellation(
    client,
    job.id,
    options.cancellationPollMs ?? DEFAULT_CANCELLATION_POLL_MS,
  );
  try {
    const spec = job.spec.payload as GatewayAgentRunSpec;
    const runtime = spec.targetRuntimeId
      ? await registerSavedAgentRuntime(client, config, spec.targetRuntimeId)
      : undefined;
    const runtimeId = spec.targetRuntimeId ?? runtime?.id ?? 'sd';
    if (await isJobCancelled(client, job.id)) {
      return cancelledSummary(job.id);
    }
    await safeAppendLog(client, {
      target: job.id,
      message: 'agent runtime started',
      data: { runtimeId, jobKind: job.spec.kind },
    });
    const result = await runGatewayAgentRuntime(spec, {
      runtime,
      timeoutMs: job.spec.timeoutMs,
      signal: monitor.signal,
      onEvent: (event) => appendRuntimeEventLog(client, job.id, runtimeId, event),
    });
    if (await isJobCancelled(client, job.id)) {
      return cancelledSummary(job.id);
    }
    await client.completeJob(job.id, {
      runtimeId: result.runtimeId,
      summary: result.summary,
      content: result.content,
      metrics: result.metrics,
      outputArtifact: result.outputArtifact,
    });
    return summary(1, 0, result.summary ?? `completed ${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (monitor.cancelled || (await isJobCancelled(client, job.id))) {
      await safeAppendLog(client, {
        level: 'warn',
        target: job.id,
        message: 'agent runtime cancelled',
        data: { error: message },
      });
      return cancelledSummary(job.id);
    }
    await client.failJob(job.id, message);
    return summary(0, 1, message);
  } finally {
    monitor.stop();
  }
}

function cancelledSummary(jobId: string): SdBackgroundServiceResult {
  return summary(0, 0, `cancelled ${jobId}`);
}

function summary(completed: number, failed: number, text: string): SdBackgroundServiceResult {
  return {
    summary: text,
    metrics: { completed, failed },
  };
}
