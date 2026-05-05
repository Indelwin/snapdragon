import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { createSdGatewayChannelStore } from './gateway-channels.js';

export async function channelsCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  const store = createSdGatewayChannelStore(await loadSdConfig(args.configPath));
  if (action === 'list') {
    const channels = await store.list();
    if (channels.length === 0) return 'No gateway channels.\n';
    return `${channels.map((channel) => `${channel.target}\t${channel.root}`).join('\n')}\n`;
  }
  if (action === 'ensure') return ensureChannel(rest[0], store);
  if (action === 'show') return showChannel(rest[0], store);
  return `Unknown gateway channels command: ${action}\n`;
}

async function ensureChannel(
  target: string | undefined,
  store: ReturnType<typeof createSdGatewayChannelStore>,
): Promise<string> {
  if (!target) return 'gateway channels ensure requires a target\n';
  const channel = await store.ensure(target);
  return `Ensured gateway channel ${channel.target}\n${channel.root}\n`;
}

async function showChannel(
  target: string | undefined,
  store: ReturnType<typeof createSdGatewayChannelStore>,
): Promise<string> {
  if (!target) return 'gateway channels show requires a target\n';
  return `${JSON.stringify(await store.ensure(target), null, 2)}\n`;
}
