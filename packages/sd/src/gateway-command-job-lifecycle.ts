import type { GatewayClient } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import {
  lifecycleOptionsFromParts,
  resultFromParts,
} from './gateway-command-job-lifecycle-args.js';
import {
  formatAcquiredLease,
  formatCompleteResult,
  formatFailureResult,
} from './gateway-command-job-lifecycle-format.js';

export async function acquireGatewayJob(rest: string[], args: SdCliArgs): Promise<string> {
  const options = lifecycleOptionsFromParts(rest);
  const worker = options.worker;
  const queue = options.queue ?? 'default';
  if (!worker) return 'gateway jobs acquire requires --worker <id>\n';
  return withGateway(args, async (client) => {
    const lease = await client.acquireJob(queue, worker, options.leaseMs);
    return lease ? formatAcquiredLease(lease) : `No gateway jobs available on queue ${queue}.\n`;
  });
}

export async function completeGatewayJob(rest: string[], args: SdCliArgs): Promise<string> {
  const [id, ...resultParts] = rest;
  if (!id) return 'gateway jobs complete requires <id> [result]\n';
  return withGateway(args, async (client) => {
    const job = await client.completeJob(id, resultFromParts(resultParts));
    return formatCompleteResult(id, job);
  });
}

export async function failGatewayJob(rest: string[], args: SdCliArgs): Promise<string> {
  const [id, ...messageParts] = rest;
  const message = messageParts.join(' ').trim();
  if (!id || !message) return 'gateway jobs fail requires <id> <error>\n';
  return withGateway(args, async (client) => {
    const job = await client.failJob(id, message);
    return formatFailureResult(id, message, job);
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
