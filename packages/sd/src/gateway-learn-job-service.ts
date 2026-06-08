import type { GatewayClient, GatewayJobStatus } from '@snapdragon-ai/gateway';
import {
  antiGamingRubric,
  evaluateDataset,
  type LearnEvalGatewayPayload,
  type RolloutTrace,
} from '@snapdragon-ai/learn';
import type { SdBackgroundService, SdBackgroundServiceResult } from './background.js';
import { rustGatewayClientForConfig } from './gateway-command-client.js';
import {
  gatewayJobWorkerId,
  heartbeatGatewayJobWorker,
  registerGatewayJobWorker,
} from './gateway-job-worker-registry.js';

const LEARN_JOB_QUEUE = 'learn';
const LEARN_JOB_SERVICE = 'learn-jobs';

export function gatewayLearnJobService(): SdBackgroundService {
  return {
    name: LEARN_JOB_SERVICE,
    enabled: (ctx) => ctx.config.gateway?.services?.['learn-jobs']?.enabled === true,
    intervalMs: (ctx) => ctx.config.gateway?.services?.['learn-jobs']?.interval_ms ?? 60_000,
    startupDelayMs: (ctx) =>
      ctx.config.gateway?.services?.['learn-jobs']?.startup_delay_ms ?? 5_000,
    async runOnce(ctx): Promise<SdBackgroundServiceResult> {
      const client = rustGatewayClientForConfig(ctx.config);
      const workerId = learnJobWorkerId();
      await registerLearnJobWorker(client, workerId);
      const lease = await client.acquireJob(LEARN_JOB_QUEUE, workerId);
      if (!lease) {
        await heartbeatLearnJobWorker(client, workerId, 'idle', 'waiting for learn.eval jobs');
        return summary(0, 0, 'no queued learn jobs');
      }
      if (lease.job.spec.kind !== 'learn.eval') {
        const message = `unsupported learn job kind: ${lease.job.spec.kind}`;
        await client.failJob(lease.job.id, message);
        await heartbeatLearnJobWorker(
          client,
          workerId,
          'idle',
          `unsupported learn job ${lease.job.id}`,
          {
            lastError: message,
          },
        );
        return summary(0, 1, `unsupported learn job ${lease.job.id}`);
      }
      return runLearnEvalJob(client, lease.job, { workerId });
    },
  };
}

export interface GatewayLearnJobRunOptions {
  workerId?: string;
}

export async function runLearnEvalJob(
  client: GatewayClient,
  job: GatewayJobStatus,
  options: GatewayLearnJobRunOptions = {},
): Promise<SdBackgroundServiceResult> {
  try {
    const payload = assertEvalPayload(job.spec.payload);
    await heartbeatLearnJobWorker(
      client,
      options.workerId,
      'running',
      `running learn eval ${job.id}`,
      {
        metadata: learnJobWorkerMetadata({ currentJobId: job.id, datasetId: payload.dataset.id }),
      },
    );
    const result = await evaluateDataset(
      payload.job,
      payload.dataset,
      antiGamingRubric(),
      rolloutFromMetadata,
    );
    await client.completeJob(job.id, result);
    await heartbeatLearnJobWorker(
      client,
      options.workerId,
      'idle',
      `completed learn eval ${job.id}`,
      {
        metadata: learnJobWorkerMetadata({
          lastJobId: job.id,
          datasetId: payload.dataset.id,
          score: result.score,
        }),
      },
    );
    return summary(1, 0, `learn eval ${payload.job.id} score=${result.score.toFixed(3)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.failJob(job.id, message);
    await heartbeatLearnJobWorker(client, options.workerId, 'idle', message, {
      lastError: message,
    });
    return summary(0, 1, message);
  }
}

export function learnJobWorkerId(pid = process.pid): string {
  return gatewayJobWorkerId(LEARN_JOB_SERVICE, pid);
}

export async function registerLearnJobWorker(
  client: GatewayClient,
  workerId: string,
): Promise<void> {
  await registerGatewayJobWorker(client, {
    id: workerId,
    queue: LEARN_JOB_QUEUE,
    service: LEARN_JOB_SERVICE,
    capabilities: ['learn.eval'],
    status: 'waiting for learn.eval jobs',
    metadata: learnJobWorkerMetadata(),
  });
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

function learnJobWorkerMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adapter: '@snapdragon-ai/sd/learn-jobs',
    pid: process.pid,
    supportedJobKinds: ['learn.eval'],
    ...extra,
  };
}

async function heartbeatLearnJobWorker(
  client: GatewayClient,
  workerId: string | undefined,
  state: 'idle' | 'running',
  status: string,
  options: { lastError?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await heartbeatGatewayJobWorker(client, {
    id: workerId,
    state,
    status,
    lastError: options.lastError,
    metadata: options.metadata,
  });
}

function summary(completed: number, failed: number, text: string): SdBackgroundServiceResult {
  return { summary: text, metrics: { completed, failed } };
}
