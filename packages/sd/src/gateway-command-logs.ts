import type { GatewayLogRecord } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

export async function logsCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action === 'tail') return tailLogs(rest, args);
  return `Unknown gateway logs command: ${action}\n`;
}

async function tailLogs(rest: string[], args: SdCliArgs): Promise<string> {
  const { target, limit } = parseTailArgs(rest);
  const config = await loadSdConfig(args.configPath);
  try {
    const logs = await rustGatewayClientForConfig(config).tailLogs({ target, limit });
    return logs.length ? `gateway logs\n${logs.map(formatLog).join('\n')}\n` : 'No gateway logs.\n';
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

function parseTailArgs(rest: string[]): { target?: string; limit?: number } {
  const limit = Number(rest.find((part) => /^\d+$/.test(part)));
  const target = rest.find((part) => !/^\d+$/.test(part));
  return { target, limit: Number.isFinite(limit) && limit > 0 ? limit : undefined };
}

function formatLog(log: GatewayLogRecord): string {
  const target = log.target ? `\t${log.target}` : '';
  return `${new Date(log.atMs).toISOString()}\t${log.level}${target}\t${log.message}`;
}
