import type { GatewayClient, GatewayJobStatus } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

type JobsHandler = (rest: string[], args: SdCliArgs) => Promise<string>;

const JOB_HANDLERS: Record<string, JobsHandler> = {
  enqueue: enqueueJob,
  list: (_rest, args) => listJobs(args),
  show: (rest, args) => showJob(rest[0], args),
  cancel: (rest, args) => cancelJob(rest[0], args),
  retry: (rest, args) => retryJob(rest[0], args),
};

export async function jobsCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  const handler = JOB_HANDLERS[action];
  return handler ? handler(rest, args) : `Unknown gateway jobs command: ${action}\n`;
}

async function enqueueJob(rest: string[], args: SdCliArgs): Promise<string> {
  const [kind, ...promptParts] = rest;
  if (!kind) return 'gateway jobs enqueue requires <kind> [payload]\n';
  const payload = payloadFromParts(promptParts);
  return withGateway(args, async (client) => {
    const job = await client.enqueueJob({ kind, payload });
    return `enqueued ${job.id}\t${job.spec.kind}\t${job.state}\n`;
  });
}

async function listJobs(args: SdCliArgs): Promise<string> {
  return withGateway(args, async (client) => {
    const jobs = await client.listJobs();
    return jobs.length ? `gateway jobs\n${jobs.map(formatJob).join('\n')}\n` : 'No gateway jobs.\n';
  });
}

async function showJob(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway jobs show requires <id>\n';
  return withGateway(args, async (client) => {
    const job = await client.showJob(id);
    return job ? `${JSON.stringify(job, null, 2)}\n` : `Unknown gateway job: ${id}\n`;
  });
}

async function cancelJob(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway jobs cancel requires <id>\n';
  return withGateway(args, async (client) => {
    const job = await client.cancelJob(id);
    return job ? `cancelled ${job.id}\n` : `Unknown gateway job: ${id}\n`;
  });
}

async function retryJob(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway jobs retry requires <id>\n';
  return withGateway(args, async (client) => {
    const job = await client.retryJob(id);
    if (!job) return `Unknown gateway job: ${id}\n`;
    return job.state === 'pending'
      ? `retry scheduled ${job.id}\n`
      : `job ${job.id} is ${job.state}; retry not scheduled\n`;
  });
}

async function withGateway(
  args: SdCliArgs,
  fn: (client: GatewayClient) => Promise<string>,
): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  try {
    return await fn(rustGatewayClientForConfig(config));
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

function payloadFromParts(parts: string[]): unknown {
  const text = parts.join(' ');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { prompt: text };
  }
}

function formatJob(job: GatewayJobStatus): string {
  const error = job.lastError ? ` error=${job.lastError}` : '';
  return `${job.id}\t${job.state}\t${job.spec.kind}\tqueue=${job.spec.queue}\tattempts=${job.attempts}${error}`;
}
