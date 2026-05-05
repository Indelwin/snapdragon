import type { ActorId, GatewayRegistrySnapshot } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

export async function registryCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action === 'list') return registryList(args);
  if (action === 'whereis') return registryWhereis(rest[0], args);
  return `Unknown gateway registry command: ${action}\n`;
}

async function registryList(args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  try {
    return formatRegistry(await rustGatewayClientForConfig(config).registrySnapshot());
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

async function registryWhereis(capability: string | undefined, args: SdCliArgs): Promise<string> {
  if (!capability) return 'gateway registry whereis requires a capability\n';
  const config = await loadSdConfig(args.configPath);
  try {
    const actors = await rustGatewayClientForConfig(config).whereisCapability(capability);
    return actors.length
      ? `${capability}\t${formatActors(actors)}\n`
      : `No providers registered for ${capability}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

function formatRegistry(snapshot: GatewayRegistrySnapshot): string {
  const lines = ['gateway registry'];
  appendActorMap(lines, 'names', snapshot.names);
  appendCapabilities(lines, snapshot.capabilities);
  appendActorMap(lines, 'channels', snapshot.channels);
  return `${lines.join('\n')}\n`;
}

function appendActorMap(lines: string[], label: string, map: Record<string, ActorId>): void {
  const entries = Object.entries(map);
  lines.push(`${label}: ${entries.length || 'none'}`);
  for (const [name, actor] of entries) lines.push(`  ${name}\t${actor.id}`);
}

function appendCapabilities(lines: string[], capabilities: Record<string, ActorId[]>): void {
  const entries = Object.entries(capabilities);
  lines.push(`capabilities: ${entries.length || 'none'}`);
  for (const [capability, actors] of entries) {
    lines.push(`  ${capability}\t${formatActors(actors)}`);
  }
}

function formatActors(actors: ActorId[]): string {
  return actors.map((actor) => actor.id).join(', ');
}
