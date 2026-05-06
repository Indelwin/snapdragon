import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import { runGatewayDaemonAlias } from './gateway-command-daemon.js';
import { cancelGatewayChannelEvent, writeSdGatewayChannelEvent } from './gateway-events-files.js';
import { gatewayEventRootForConfig } from './gateway-events-types.js';

type EventHandler = (rest: string[], args: SdCliArgs) => Promise<string>;

const EVENT_HANDLERS: Record<string, EventHandler> = {
  enqueue: (rest, args) => enqueueEvent(rest, args),
  list: (_rest, args) => listEventFiles(args),
  cancel: (rest, args) => cancelEvent(rest[0], args),
  run: (_rest, args) => runGatewayDaemonAlias('run-once', args),
};

export async function eventsCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  const handler = EVENT_HANDLERS[action];
  return handler ? handler(rest, args) : `Unknown gateway events command: ${action}\n`;
}

async function enqueueEvent(rest: string[], args: SdCliArgs): Promise<string> {
  const channel = rest[0];
  const prompt = rest.slice(1).join(' ');
  if (!channel || !prompt) return 'gateway events enqueue requires <channel> <prompt>\n';
  const root = await eventRoot(args);
  const result = await writeSdGatewayChannelEvent(root, { channel, prompt, type: 'immediate' });
  return `Enqueued gateway event ${result.event.id}\n${result.path}\n`;
}

async function listEventFiles(args: SdCliArgs): Promise<string> {
  const lines: string[] = [];
  const root = await eventRoot(args);
  for (const state of ['pending', 'running', 'done', 'failed', 'cancelled']) {
    await collectEventFiles(lines, root, state);
  }
  return lines.length ? `${lines.join('\n')}\n` : 'No gateway events.\n';
}

async function cancelEvent(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway events cancel requires <id>\n';
  const root = await eventRoot(args);
  const path = await cancelGatewayChannelEvent(root, id);
  if (path) return `Cancelled gateway event ${id}\n${path}\n`;
  const config = await loadSdConfig(args.configPath);
  try {
    const event = await rustGatewayClientForConfig(config).cancelEvent(id);
    return event ? `Cancelled durable gateway event ${id}\n` : `Unknown gateway event: ${id}\n`;
  } catch (error) {
    return `Unknown gateway event: ${id}\nRust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

async function collectEventFiles(lines: string[], root: string, state: string): Promise<void> {
  const dir = join(root, state);
  if (!existsSync(dir)) return;
  for (const name of await readdir(dir)) {
    if (name.endsWith('.json')) lines.push(`${state}\t${name}`);
  }
}

async function eventRoot(args: SdCliArgs): Promise<string> {
  return gatewayEventRootForConfig(await loadSdConfig(args.configPath));
}
