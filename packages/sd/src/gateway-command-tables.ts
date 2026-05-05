import type { GatewayTableSnapshot } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

export async function tablesCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action === 'list') return tablesList(args);
  if (action === 'show') return tablesShow(rest[0], args);
  return `Unknown gateway tables command: ${action}\n`;
}

async function tablesList(args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  try {
    const names = await rustGatewayClientForConfig(config).tableNames();
    return names.length ? `gateway tables\n${names.join('\n')}\n` : 'No gateway tables.\n';
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

async function tablesShow(name: string | undefined, args: SdCliArgs): Promise<string> {
  if (!name) return 'gateway tables show requires a table name\n';
  const config = await loadSdConfig(args.configPath);
  try {
    const table = await rustGatewayClientForConfig(config).tableSnapshot(name);
    return table ? formatTable(table) : `Gateway table not found: ${name}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

function formatTable(table: GatewayTableSnapshot): string {
  return [
    `gateway table ${table.name}`,
    `owner: ${table.owner.id}`,
    `access: ${table.access}`,
    `rows: ${table.rows}`,
    '',
  ].join('\n');
}
