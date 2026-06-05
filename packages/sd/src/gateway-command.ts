import type { SdCliArgs } from './args-types.js';
import { agentsCommand } from './gateway-command-agents.js';
import { channelsCommand } from './gateway-command-channels.js';
import {
  isGatewayDaemonAlias,
  restartGateway,
  runGatewayDaemonAlias,
} from './gateway-command-daemon.js';
import { eventsCommand } from './gateway-command-events.js';
import { inspectCommand } from './gateway-command-inspect.js';
import { jobsCommand } from './gateway-command-jobs.js';
import { learnCommand } from './gateway-command-learn.js';
import { logsCommand } from './gateway-command-logs.js';
import type { GatewayCommandOptions } from './gateway-command-options.js';
import { registryCommand } from './gateway-command-registry.js';
import { restCommand } from './gateway-command-rest.js';
import { sandboxesCommand } from './gateway-command-sandboxes.js';
import { servicesCommand } from './gateway-command-services.js';
import { tablesCommand } from './gateway-command-tables.js';
import { workersCommand } from './gateway-command-workers.js';

type GatewayTopicHandler = (
  action: string | undefined,
  rest: string[],
  args: SdCliArgs,
  options: GatewayCommandOptions,
) => Promise<string>;

const gatewayTopicHandlers: Record<string, GatewayTopicHandler> = {
  agents: (action, rest, args) => agentsCommand(action ?? 'status', rest, args),
  channels: (action, rest, args) => channelsCommand(action ?? 'list', rest, args),
  events: (action, rest, args) => eventsCommand(action ?? 'list', rest, args),
  inspect: (action, rest, args) => inspectCommand([action, ...rest].filter(isString), args),
  jobs: (action, rest, args) => jobsCommand(action ?? 'list', rest, args),
  learn: (action, rest, args) => learnCommand(action ?? 'enqueue-eval', rest, args),
  logs: (action, rest, args) => logsCommand(action ?? 'tail', rest, args),
  registry: (action, rest, args) => registryCommand(action ?? 'list', rest, args),
  rest: (action, rest, args, options) => restCommand(action ?? 'serve', rest, args, options),
  sandboxes: (action, rest, args) => sandboxesCommand(action ?? 'list', rest, args),
  services: (action, rest, args) => servicesCommand(action ?? 'list', rest, args),
  tables: (action, rest, args) => tablesCommand(action ?? 'list', rest, args),
  workers: (action, rest, args) => workersCommand(action ?? 'list', rest, args),
  async worker(action, rest, args) {
    const { gatewayWorkerCommand } = await import('./gateway-worker.js');
    return gatewayWorkerCommand(action ?? 'run', rest, args);
  },
};

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}

export async function runGatewayCommand(
  args: SdCliArgs,
  options: GatewayCommandOptions = {},
): Promise<string> {
  const [topic = 'status', action, ...rest] = args.gatewayArgs ?? [];
  if (isGatewayDaemonAlias(topic)) return runGatewayDaemonAlias(topic, args);
  if (topic === 'restart') return restartGateway(args);
  if (topic === 'ps') return runGatewayDaemonAlias('status', args);
  const handler = gatewayTopicHandlers[topic];
  if (handler) return handler(action, rest, args, options);
  return `Unknown gateway command: ${topic}\n`;
}
