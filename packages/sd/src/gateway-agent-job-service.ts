import type { GatewayAgentRunSpec, GatewayClient, GatewayJobStatus } from '@snapdragon-ai/gateway';
import type { SdBackgroundService, SdBackgroundServiceResult } from './background.js';
import type { SdConfig } from './config-schema.js';
import { runGatewayAgentRuntime } from './gateway-agent-dispatch.js';
import { isJobCancelled, monitorJobCancellation } from './gateway-agent-job-control.js';
import { appendRuntimeEventLog, safeAppendLog } from './gateway-agent-job-logs.js';
import { configuredAgentRuntimeDescriptors } from './gateway-agent-runtime-config.js';
import { registerSavedAgentRuntime } from './gateway-agent-runtime-resolve.js';
import { rustGatewayClientForConfig } from './gateway-command-client.js';

const DEFAULT_CANCELLATION_POLL_MS = 1_000;
const AGENT_JOB_QUEUE = 'default';
const AGENT_JOB_SERVICE = 'agent-jobs';

export interface GatewayAgentJobRunOptions {
  cancellationPollMs?: number;
  workerId?: string;
}

export function gatewayAgentJobService(): SdBackgroundService {
  return {
    name: AGENT_JOB_SERVICE,
    enabled: (ctx) => ctx.config.gateway?.services?.['agent-jobs']?.enabled !== false,
    intervalMs: (ctx) => ctx.config.gateway?.services?.['agent-jobs']?.interval_ms ?? 30_000,
    startupDelayMs: (ctx) =>
      ctx.config.gateway?.services?.['agent-jobs']?.startup_delay_ms ?? 1_000,
    async runOnce(ctx): Promise<SdBackgroundServiceResult> {
      const client = rustGatewayClientForConfig(ctx.config);
      const workerId = agentJobWorkerId();
      await registerAgentJobWorker(client, ctx.config, workerId);
      const lease = await client.acquireJob(AGENT_JOB_QUEUE, workerId);
      if (!lease) {
        await heartbeatAgentJobWorker(client, workerId, 'idle', 'waiting for agent.run jobs');
        return summary(0, 0, 'no queued agent jobs');
      }
      if (lease.job.spec.kind !== 'agent.run') {
        await client.failJob(lease.job.id, `unsupported job kind: ${lease.job.spec.kind}`);
        await heartbeatAgentJobWorker(client, workerId, 'idle', `unsupported job ${lease.job.id}`);
        return summary(0, 1, `unsupported job ${lease.job.id}`);
      }
      return runGatewayAgentJob(client, ctx.config, lease.job, { workerId });
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
    await heartbeatRunningAgentJobWorker(client, config, options.workerId, job.id, runtimeId);
    if (await isJobCancelled(client, job.id)) {
      await heartbeatAgentJobWorker(client, options.workerId, 'idle', `cancelled ${job.id}`);
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
    await heartbeatAgentJobWorker(client, options.workerId, 'idle', `completed ${job.id}`);
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
      await heartbeatAgentJobWorker(client, options.workerId, 'idle', `cancelled ${job.id}`);
      return cancelledSummary(job.id);
    }
    await client.failJob(job.id, message);
    await heartbeatAgentJobWorker(client, options.workerId, 'idle', message, message);
    return summary(0, 1, message);
  } finally {
    monitor.stop();
  }
}

export function agentJobWorkerId(pid = process.pid): string {
  return `${AGENT_JOB_SERVICE}-${pid}`;
}

export async function registerAgentJobWorker(
  client: GatewayClient,
  config: SdConfig,
  workerId: string,
): Promise<void> {
  await client.registerWorker({
    id: workerId,
    queue: AGENT_JOB_QUEUE,
    service: AGENT_JOB_SERVICE,
    capabilities: ['agent.run'],
    status: 'waiting for agent.run jobs',
    metadata: agentJobWorkerMetadata(config),
  });
}

function agentJobWorkerMetadata(config: SdConfig): Record<string, unknown> {
  return {
    adapter: '@snapdragon-ai/sd/agent-jobs',
    pid: process.pid,
    supportedRuntimeIds: [
      'sd',
      ...configuredAgentRuntimeDescriptors(config).map((runtime) => runtime.id),
    ],
  };
}

async function heartbeatRunningAgentJobWorker(
  client: GatewayClient,
  config: SdConfig,
  workerId: string | undefined,
  jobId: string,
  runtimeId: string,
): Promise<void> {
  await heartbeatAgentJobWorker(client, workerId, 'running', `running ${runtimeId} job ${jobId}`, {
    ...agentJobWorkerMetadata(config),
    currentRuntimeId: runtimeId,
    currentJobId: jobId,
  });
}

async function heartbeatAgentJobWorker(
  client: GatewayClient,
  workerId: string | undefined,
  state: 'idle' | 'running',
  status: string,
  lastErrorOrMetadata?: string | Record<string, unknown>,
): Promise<void> {
  if (!workerId) return;
  const heartbeat = {
    id: workerId,
    state,
    status,
    lastError: typeof lastErrorOrMetadata === 'string' ? lastErrorOrMetadata : undefined,
    metadata: typeof lastErrorOrMetadata === 'object' ? lastErrorOrMetadata : undefined,
  };
  await client.heartbeatWorker(heartbeat);
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
