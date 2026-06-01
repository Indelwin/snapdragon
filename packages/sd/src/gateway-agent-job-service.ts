import type { GatewayAgentRunSpec, GatewayJobStatus } from '@snapdragon-ai/gateway';
import type { SdBackgroundService, SdBackgroundServiceResult } from './background.js';
import type { SdConfig } from './config-schema.js';
import { runGatewayAgentRuntime } from './gateway-agent-dispatch.js';
import { registerSavedAgentRuntime } from './gateway-agent-runtime-resolve.js';
import { rustGatewayClientForConfig } from './gateway-command-client.js';

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
      return runAgentJob(client, ctx.config, lease.job);
    },
  };
}

async function runAgentJob(
  client: ReturnType<typeof rustGatewayClientForConfig>,
  config: SdConfig,
  job: GatewayJobStatus,
): Promise<SdBackgroundServiceResult> {
  try {
    const spec = job.spec.payload as GatewayAgentRunSpec;
    const runtime = spec.targetRuntimeId
      ? await registerSavedAgentRuntime(client, config, spec.targetRuntimeId)
      : undefined;
    const result = await runGatewayAgentRuntime(spec, {
      runtime,
      timeoutMs: job.spec.timeoutMs,
    });
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
    await client.failJob(job.id, message);
    return summary(0, 1, message);
  }
}

function summary(completed: number, failed: number, text: string): SdBackgroundServiceResult {
  return {
    summary: text,
    metrics: { completed, failed },
  };
}
