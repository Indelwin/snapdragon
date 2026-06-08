import type { GatewayClient, GatewayWorkerRecord } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

type WorkersHandler = (rest: string[], args: SdCliArgs) => Promise<string>;

const WORKER_HANDLERS: Record<string, WorkersHandler> = {
  list: (_rest, args) => listWorkers(args),
  show: (rest, args) => showWorker(rest[0], args),
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

function formatWorker(worker: GatewayWorkerRecord): string {
  const runtime = worker.runtimeId ? ` runtime=${worker.runtimeId}` : '';
  const service = worker.service ? ` service=${worker.service}` : '';
  const job = worker.currentJobId ? ` job=${worker.currentJobId}` : '';
  const lease = worker.currentLeaseId ? ` lease=${worker.currentLeaseId}` : '';
  const status = worker.status ? ` ${worker.status}` : '';
  const error = worker.lastError ? ` error=${worker.lastError}` : '';
  return `${worker.id}\t${worker.state}\tqueue=${worker.queue}${service}${runtime}${job}${lease}${status}${error}`;
}
