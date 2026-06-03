import type { GatewayWorkerRecord, GatewayWorkerRegistration } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

type WorkersHandler = (rest: string[], args: SdCliArgs) => Promise<string>;

const WORKER_HANDLERS: Record<string, WorkersHandler> = {
  list: (_rest, args) => listWorkers(args),
  show: (rest, args) => showWorker(rest[0], args),
  register: registerWorker,
  heartbeat: (rest, args) => heartbeatWorker(rest, args),
};

export async function workersCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  const handler = WORKER_HANDLERS[action];
  return handler ? handler(rest, args) : `Unknown gateway workers command: ${action}\n`;
}

async function listWorkers(args: SdCliArgs): Promise<string> {
  return withGateway(args, async (client) => {
    const workers = await client.listWorkers();
    return workers.length
      ? `gateway workers\n${workers.map(formatWorker).join('\n')}\n`
      : 'No gateway workers.\n';
  });
}

async function showWorker(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway workers show requires <id>\n';
  return withGateway(args, async (client) => {
    const worker = await client.showWorker(id);
    return worker ? `${JSON.stringify(worker, null, 2)}\n` : `Unknown gateway worker: ${id}\n`;
  });
}

async function registerWorker(rest: string[], args: SdCliArgs): Promise<string> {
  const [id, ...parts] = rest;
  if (!id) return 'gateway workers register requires <id> [--queue queue] [--runtime id]\n';
  const worker = workerRegistrationFromParts(id, parts);
  return withGateway(args, async (client) => {
    const record = await client.registerWorker(worker);
    return `registered worker ${record.id}\tqueue=${record.queue}\tstate=${record.state}\n`;
  });
}

async function heartbeatWorker(rest: string[], args: SdCliArgs): Promise<string> {
  const [id, ...parts] = rest;
  if (!id) return 'gateway workers heartbeat requires <id>\n';
  const options = optionsFromParts(parts);
  return withGateway(args, async (client) => {
    const worker = await client.heartbeatWorker({
      id,
      state: optionValue(options, 'state') as GatewayWorkerRecord['state'] | undefined,
      queue: optionValue(options, 'queue'),
      status: optionValue(options, 'status'),
    });
    return worker
      ? `heartbeat worker ${worker.id}\tstate=${worker.state}\n`
      : `Unknown gateway worker: ${id}\n`;
  });
}

function workerRegistrationFromParts(id: string, parts: string[]): GatewayWorkerRegistration {
  const options = optionsFromParts(parts);
  return {
    id,
    queue: optionValue(options, 'queue'),
    runtimeId: optionValue(options, 'runtime'),
    service: optionValue(options, 'service'),
    capabilities: options.capability ?? options.capabilities ?? [],
    status: optionValue(options, 'status'),
  };
}

async function withGateway(
  args: SdCliArgs,
  fn: (client: ReturnType<typeof rustGatewayClientForConfig>) => Promise<string>,
): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  try {
    return await fn(rustGatewayClientForConfig(config));
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

function optionsFromParts(parts: string[]): Record<string, string[]> {
  const options: Record<string, string[]> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part?.startsWith('--')) continue;
    const key = part.slice(2);
    const value = parts[i + 1];
    if (!value || value.startsWith('--')) continue;
    options[key] = [...(options[key] ?? []), value];
    i += 1;
  }
  return options;
}

function optionValue(options: Record<string, string[]>, key: string): string | undefined {
  return options[key]?.[0];
}

function formatWorker(worker: GatewayWorkerRecord): string {
  const current = worker.currentJobId ? ` job=${worker.currentJobId}` : '';
  const runtime = worker.runtimeId ? ` runtime=${worker.runtimeId}` : '';
  const status = worker.status ? ` status=${worker.status}` : '';
  return `${worker.id}\t${worker.state}\tqueue=${worker.queue}${runtime}${current}${status}`;
}
