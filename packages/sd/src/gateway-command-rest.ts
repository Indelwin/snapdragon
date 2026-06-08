import { writeFile } from 'node:fs/promises';
import { stdout } from 'node:process';
import { createGatewayRestServer } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import {
  type GatewayRestServeParsedOptions,
  parseGatewayRestServeOptions,
} from './gateway-rest-options.js';

interface TextSink {
  write(chunk: string): unknown;
}

export interface GatewayRestServeControl {
  signal?: AbortSignal;
  stdout?: TextSink;
}

export async function restCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action === 'serve' || action === 'run') return serveGatewayRest(rest, args);
  if (action === 'help') return restHelp();
  return `Unknown gateway rest command: ${action}\n`;
}

export async function serveGatewayRest(
  rest: string[],
  args: SdCliArgs,
  control: GatewayRestServeControl = {},
): Promise<string> {
  const parsed = parseGatewayRestServeOptions(rest);
  if (typeof parsed === 'string') return parsed;
  const config = await loadSdConfig(args.configPath);
  if (config.gateway?.runtime === 'inline-ts') {
    return 'gateway rest serve requires the rust gateway runtime\n';
  }
  const client = rustGatewayClientForConfig(config);
  try {
    await client.status();
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }

  const server = createGatewayRestServer(client, parsed);
  try {
    const url = await server.listen({ hostname: parsed.hostname, port: parsed.port });
    await announceReady(url, parsed, control.stdout ?? stdout);
    await waitForStop(control.signal);
    return 'gateway rest stopped\n';
  } catch (error) {
    return `gateway rest failed: ${gatewayErrorMessage(error)}\n`;
  } finally {
    await server.close().catch(() => undefined);
  }
}

async function announceReady(
  url: string,
  options: GatewayRestServeParsedOptions,
  sink: TextSink,
): Promise<void> {
  if (options.readyFile) await writeFile(options.readyFile, `${url}\n`, 'utf8');
  const line = options.json
    ? `${JSON.stringify({ url, pathPrefix: options.pathPrefix })}\n`
    : `gateway rest listening ${url}\n`;
  sink.write(line);
}

function waitForStop(signal?: AbortSignal): Promise<void> {
  if (signal) return waitForAbort(signal);
  return new Promise((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = () => {
      signal.removeEventListener('abort', stop);
      resolve();
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

function restHelp(): string {
  return [
    'sd gateway rest serve [--host <host>] [--port <port>]',
    '  --prefix <path>       REST path prefix, default /v1',
    '  --stream-ms <ms>      SSE snapshot interval, default 1000',
    '  --ready-file <path>   Write the bound base URL for process managers',
    '  --json                Print ready metadata as JSON',
    '',
  ].join('\n');
}
