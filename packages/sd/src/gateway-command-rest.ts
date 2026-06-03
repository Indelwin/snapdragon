import {
  createGatewayRestServer,
  type GatewayOrchestrationClient,
  InlineGatewayClient,
} from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { rustGatewayClientForConfig } from './gateway-command-client.js';
import type { GatewayCommandOptions } from './gateway-command-options.js';
import { assertLocalBind, parseRestServeArgs } from './gateway-command-rest-args.js';
import { startRustGateway } from './gateway-rust-process.js';

export async function restCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
  options: GatewayCommandOptions = {},
): Promise<string> {
  if (action !== 'serve') return `Unknown gateway rest command: ${action}\n`;
  return serveRest(rest, args, options);
}

async function serveRest(
  rest: string[],
  args: SdCliArgs,
  options: GatewayCommandOptions,
): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  const parsed = parseRestServeArgs(rest);
  assertLocalBind(parsed);
  if (parsed.start && config.gateway?.runtime !== 'inline-ts') await startRustGateway(args, config);
  const client =
    config.gateway?.runtime === 'inline-ts'
      ? new InlineGatewayClient()
      : rustGatewayClientForConfig(config);
  await verifyGatewayReachable(client);
  const server = createGatewayRestServer(client, {
    hostname: parsed.hostname,
    port: parsed.port,
    pathPrefix: parsed.pathPrefix,
    streamHeartbeatMs: parsed.streamHeartbeatMs,
    streamIntervalMs: parsed.streamIntervalMs,
  });
  const url = await server.listen();
  const listening = `gateway REST listening ${url}\n`;
  options.stdout?.write(listening);
  await options.onRestListening?.(url);
  if (parsed.once) {
    await server.close();
    return options.stdout ? 'gateway REST stopped\n' : `${listening}gateway REST stopped\n`;
  }
  await waitForStop(options.signal);
  await server.close();
  return `gateway REST stopped ${url}\n`;
}

async function verifyGatewayReachable(client: GatewayOrchestrationClient): Promise<void> {
  await client.status();
}

function waitForStop(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onStop);
      process.off('SIGINT', onStop);
      process.off('SIGTERM', onStop);
    };
    const onStop = () => {
      cleanup();
      resolve();
    };
    signal?.addEventListener('abort', onStop, { once: true });
    process.once('SIGINT', onStop);
    process.once('SIGTERM', onStop);
  });
}
