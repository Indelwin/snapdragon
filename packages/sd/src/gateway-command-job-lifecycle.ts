import type { GatewayClient, GatewayJobLease, GatewayJobStatus } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import { acquireOptionsFromParts, resultFromParts } from './gateway-command-job-lifecycle-args.js';

export async function acquireGatewayJob(rest: string[], args: SdCliArgs): Promise<string> {
  const options = acquireOptionsFromParts(rest);
  if (options.error) return options.error;
  if (!options.worker) {
    return 'gateway jobs acquire requires [queue] <worker> or --worker <id>\n';
  }
  const worker = options.worker;
  return withGateway(args, async (client) => {
    const lease = await client.acquireJob(options.queue, worker, options.leaseMs);
    return lease ? formatLease(lease) : `No gateway jobs available on queue ${options.queue}.\n`;
  });
}

export async function completeGatewayJob(rest: string[], args: SdCliArgs): Promise<string> {
  const [id, ...resultParts] = rest;
  if (!id) return 'gateway jobs complete requires <id> [result]\n';
  return withGateway(args, async (client) => {
    const job = await client.completeJob(id, resultFromParts(resultParts));
    return formatComplete(id, job);
  });
}

export async function failGatewayJob(rest: string[], args: SdCliArgs): Promise<string> {
  const [id, ...messageParts] = rest;
  const message = messageParts.join(' ').trim();
  if (!id || !message) return 'gateway jobs fail requires <id> <error>\n';
  return withGateway(args, async (client) => {
    const job = await client.failJob(id, message);
    return formatFailure(id, message, job);
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

function formatLease(lease: GatewayJobLease): string {
  const expires = new Date(lease.lease.expiresAtMs).toISOString();
  return `acquired ${lease.job.id}\t${lease.job.spec.kind}\tqueue=${lease.job.spec.queue}\tworker=${lease.lease.worker}\tlease=${lease.lease.id}\texpires=${expires}\n`;
}

function formatComplete(id: string, job: GatewayJobStatus | undefined): string {
  if (!job) return `Unknown gateway job: ${id}\n`;
  return job.state === 'completed'
    ? `completed ${job.id}\n`
    : `job ${job.id} is ${job.state}; complete not applied\n`;
}

function formatFailure(id: string, message: string, job: GatewayJobStatus | undefined): string {
  if (!job) return `Unknown gateway job: ${id}\n`;
  return job.state === 'failed'
    ? `failed ${job.id}\terror=${job.lastError ?? message}\n`
    : `job ${job.id} is ${job.state}; failure not applied\n`;
}
