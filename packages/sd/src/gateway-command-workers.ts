import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import {
  formatWorker,
  workerHeartbeatFromParts,
  workerRegistrationFromParts,
} from './gateway-command-worker-args.js';

type WorkersHandler = (rest: string[], args: SdCliArgs) => Promise<string>;

const WORKER_HANDLERS: Record<string, WorkersHandler> = {
  list: (_rest, args) => listWorkers(args),
  show: (rest, args) => showWorker(rest[0], args),
  register: registerWorker,
  heartbeat: (rest, args) => heartbeatWorker(rest, args),
  remove: (rest, args) => unregisterWorker(rest[0], args),
  unregister: (rest, args) => unregisterWorker(rest[0], args),
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
  return withGateway(args, async (client) => {
    const worker = await client.heartbeatWorker(workerHeartbeatFromParts(id, parts));
    return worker
      ? `heartbeat worker ${worker.id}\tstate=${worker.state}\n`
      : `Unknown gateway worker: ${id}\n`;
  });
}

async function unregisterWorker(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway workers unregister requires <id>\n';
  return withGateway(args, async (client) => {
    const worker = await client.unregisterWorker(id);
    return worker ? `unregistered worker ${worker.id}\n` : `Unknown gateway worker: ${id}\n`;
  });
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
