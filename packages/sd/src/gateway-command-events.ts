import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { runGatewayDaemonAlias } from './gateway-command-daemon.js';
import { writeSdGatewayChannelEvent } from './gateway-events-files.js';
import { gatewayEventRootForConfig } from './gateway-events-types.js';

export async function eventsCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  const root = gatewayEventRootForConfig(await loadSdConfig(args.configPath));
  if (action === 'enqueue') return enqueueEvent(root, rest);
  if (action === 'list') return listEventFiles(root);
  if (action === 'cancel')
    return 'gateway events cancel is reserved for the Rust gateway event store.\n';
  if (action === 'run') return runGatewayDaemonAlias('run-once', args);
  return `Unknown gateway events command: ${action}\n`;
}

async function enqueueEvent(root: string, rest: string[]): Promise<string> {
  const channel = rest[0];
  const prompt = rest.slice(1).join(' ');
  if (!channel || !prompt) return 'gateway events enqueue requires <channel> <prompt>\n';
  const result = await writeSdGatewayChannelEvent(root, { channel, prompt, type: 'immediate' });
  return `Enqueued gateway event ${result.event.id}\n${result.path}\n`;
}

async function listEventFiles(root: string): Promise<string> {
  const lines: string[] = [];
  for (const state of ['pending', 'running', 'done', 'failed']) {
    await collectEventFiles(lines, root, state);
  }
  return lines.length ? `${lines.join('\n')}\n` : 'No gateway events.\n';
}

async function collectEventFiles(lines: string[], root: string, state: string): Promise<void> {
  const dir = join(root, state);
  if (!existsSync(dir)) return;
  for (const name of await readdir(dir)) {
    if (name.endsWith('.json')) lines.push(`${state}\t${name}`);
  }
}
