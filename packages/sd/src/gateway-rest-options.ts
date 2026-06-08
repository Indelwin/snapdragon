import { gatewayRestOptionReaders } from './gateway-rest-option-readers.js';
import type { GatewayRestServeParsedOptions } from './gateway-rest-option-types.js';

export type { GatewayRestServeParsedOptions } from './gateway-rest-option-types.js';

export function parseGatewayRestServeOptions(
  rest: string[],
): GatewayRestServeParsedOptions | string {
  const options: GatewayRestServeParsedOptions = defaultRestOptions();
  for (let index = 0; index < rest.length; index += 1) {
    const result = applyToken(options, rest, index);
    if (typeof result === 'string') return result;
    index += result;
  }
  return options;
}

function defaultRestOptions(): GatewayRestServeParsedOptions {
  return {
    hostname: '127.0.0.1',
    json: false,
    pathPrefix: '/v1',
    port: 8787,
  };
}

function applyToken(
  options: GatewayRestServeParsedOptions,
  rest: string[],
  index: number,
): number | string {
  const [flag, inline] = splitInlineOption(rest[index]);
  if (flag === '--json') {
    options.json = true;
    return 0;
  }
  const reader = gatewayRestOptionReaders[flag];
  if (!reader) return `Unknown gateway rest serve option: ${flag}\n`;
  const value = inline ?? rest[index + 1];
  const error = reader(options, flag, value);
  return error ?? (inline ? 0 : 1);
}

function splitInlineOption(token: string): [string, string | undefined] {
  const index = token.indexOf('=');
  if (index < 0) return [token, undefined];
  return [token.slice(0, index), token.slice(index + 1)];
}
