import type { GatewayJobStatus } from '@snapdragon-ai/gateway';
import {
  antiGamingRubric,
  evaluateDataset,
  type LearnEvalGatewayPayload,
  type RolloutTrace,
} from '@snapdragon-ai/learn';
import type { SdBackgroundService, SdBackgroundServiceResult } from './background.js';
import { rustGatewayClientForConfig } from './gateway-command-client.js';

export function gatewayLearnJobService(): SdBackgroundService {
  return {
    name: 'learn-jobs',
    enabled: (ctx) => ctx.config.gateway?.services?.['learn-jobs']?.enabled === true,
    intervalMs: (ctx) => ctx.config.gateway?.services?.['learn-jobs']?.interval_ms ?? 60_000,
    startupDelayMs: (ctx) =>
      ctx.config.gateway?.services?.['learn-jobs']?.startup_delay_ms ?? 5_000,
    async runOnce(ctx): Promise<SdBackgroundServiceResult> {
      const client = rustGatewayClientForConfig(ctx.config);
      const lease = await client.acquireJob('learn', `learn-jobs-${process.pid}`);
      if (!lease) return summary(0, 0, 'no queued learn jobs');
      if (lease.job.spec.kind !== 'learn.eval') {
        await client.failJob(lease.job.id, `unsupported learn job kind: ${lease.job.spec.kind}`);
        return summary(0, 1, `unsupported learn job ${lease.job.id}`);
      }
      return runLearnEvalJob(client, lease.job);
    },
  };
}

async function runLearnEvalJob(
  client: ReturnType<typeof rustGatewayClientForConfig>,
  job: GatewayJobStatus,
): Promise<SdBackgroundServiceResult> {
  try {
    const payload = assertEvalPayload(job.spec.payload);
    const result = await evaluateDataset(
      payload.job,
      payload.dataset,
      antiGamingRubric(),
      rolloutFromMetadata,
    );
    await client.completeJob(job.id, result);
    return summary(1, 0, `learn eval ${payload.job.id} score=${result.score.toFixed(3)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.failJob(job.id, message);
    return summary(0, 1, message);
  }
}

function assertEvalPayload(value: unknown): LearnEvalGatewayPayload {
  const payload = value as LearnEvalGatewayPayload;
  if (!payload?.job || !payload?.dataset?.examples) {
    throw new Error('learn.eval job payload requires { job, dataset }');
  }
  return payload;
}

function rolloutFromMetadata(example: LearnEvalGatewayPayload['dataset']['examples'][number]) {
  const trace = example.metadata?.rollout as Partial<RolloutTrace> | undefined;
  return {
    exampleId: example.id,
    output: trace?.output ?? String(example.metadata?.output ?? ''),
    toolCalls: Array.isArray(trace?.toolCalls) ? trace.toolCalls : [],
    metadata: trace?.metadata,
  };
}

function summary(completed: number, failed: number, text: string): SdBackgroundServiceResult {
  return { summary: text, metrics: { completed, failed } };
}
