import type { GatewayAgentRunSpec, GatewayJobStatus } from '@snapdragon-ai/gateway';
import type { SdBackgroundService, SdBackgroundServiceResult } from './background.js';
import { rustGatewayClientForConfig } from './gateway-command-client.js';
import { runHeadlessGatewayAgent } from './gateway-headless-agent.js';

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
      return runAgentJob(client, lease.job);
    },
  };
}

async function runAgentJob(
  client: ReturnType<typeof rustGatewayClientForConfig>,
  job: GatewayJobStatus,
): Promise<SdBackgroundServiceResult> {
  try {
    const result = await runHeadlessGatewayAgent(job.spec.payload as GatewayAgentRunSpec);
    await client.completeJob(job.id, {
      summary: result.summary,
      content: result.content,
      metrics: result.metrics,
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
