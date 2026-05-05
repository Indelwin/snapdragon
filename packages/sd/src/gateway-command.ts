import type { SdCliArgs } from './args-types.js';
import { channelsCommand } from './gateway-command-channels.js';
import {
  isGatewayDaemonAlias,
  restartGateway,
  runGatewayDaemonAlias,
} from './gateway-command-daemon.js';
import { eventsCommand } from './gateway-command-events.js';
import { registryCommand } from './gateway-command-registry.js';
import { servicesCommand } from './gateway-command-services.js';
import { tablesCommand } from './gateway-command-tables.js';

type GatewayTopicHandler = (
  action: string | undefined,
  rest: string[],
  args: SdCliArgs,
) => Promise<string>;

const gatewayTopicHandlers: Record<string, GatewayTopicHandler> = {
  channels: (action, rest, args) => channelsCommand(action ?? 'list', rest, args),
  events: (action, rest, args) => eventsCommand(action ?? 'list', rest, args),
  registry: (action, rest, args) => registryCommand(action ?? 'list', rest, args),
  services: (action, rest, args) => servicesCommand(action ?? 'list', rest, args),
  tables: (action, rest, args) => tablesCommand(action ?? 'list', rest, args),
  async worker(action, rest, args) {
    const { gatewayWorkerCommand } = await import('./gateway-worker.js');
    return gatewayWorkerCommand(action ?? 'run', rest, args);
  },
};

export async function runGatewayCommand(args: SdCliArgs): Promise<string> {
  const [topic = 'status', action, ...rest] = args.gatewayArgs ?? [];
  if (isGatewayDaemonAlias(topic)) return runGatewayDaemonAlias(topic, args);
  if (topic === 'restart') return restartGateway(args);
  if (topic === 'ps') return runGatewayDaemonAlias('status', args);
  const handler = gatewayTopicHandlers[topic];
  if (handler) return handler(action, rest, args);
  return `Unknown gateway command: ${topic}\n`;
}
