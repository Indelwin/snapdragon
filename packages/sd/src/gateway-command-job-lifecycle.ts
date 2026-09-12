import type { GatewayClient } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import {
  acquireOptionsFromParts,
  fenceOptionsFromParts,
  resultFromParts,
} from './gateway-command-job-lifecycle-args.js';
import {
  formatComplete,
  formatFailure,
  formatLease,
} from './gateway-command-job-lifecycle-format.js';

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
  const [id, ...parts] = rest;
  if (!id) {
    return 'gateway jobs complete requires <id> --lease-id <id> --attempt <n> [result]\n';
  }
  const options = fenceOptionsFromParts(parts);
  if (!options.ok) return options.error;
  return withGateway(args, async (client) => {
    const job = await client.completeJob(id, resultFromParts(options.values), {
      leaseId: options.leaseId,
      attempt: options.attempt,
    });
    return formatComplete(id, job);
  });
}

export async function failGatewayJob(rest: string[], args: SdCliArgs): Promise<string> {
  const [id, ...parts] = rest;
  if (!id) return 'gateway jobs fail requires <id> --lease-id <id> --attempt <n> <error>\n';
  const options = fenceOptionsFromParts(parts);
  if (!options.ok) return options.error;
  const message = options.values.join(' ').trim();
  if (!message) return 'gateway jobs fail requires an error message\n';
  return withGateway(args, async (client) => {
    const job = await client.failJob(id, message, {
      leaseId: options.leaseId,
      attempt: options.attempt,
    });
    return formatFailure(id, message, job);
  });
}

export async function renewGatewayJob(rest: string[], args: SdCliArgs): Promise<string> {
  const [id, ...parts] = rest;
  if (!id)
    return 'gateway jobs renew requires <id> --lease-id <id> --attempt <n> [--lease-ms <n>]\n';
  const options = fenceOptionsFromParts(parts);
  if (!options.ok) return options.error;
  return withGateway(args, async (client) => {
    const renewed = await client.renewJob(
      id,
      { leaseId: options.leaseId, attempt: options.attempt },
      options.leaseMs,
    );
    return renewed ? formatLease(renewed) : `Unknown gateway job: ${id}\n`;
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
