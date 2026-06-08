import type { GatewayRestServeParsedOptions } from './gateway-rest-option-types.js';

export type GatewayRestOptionReader = (
  options: GatewayRestServeParsedOptions,
  flag: string,
  value: string | undefined,
) => string | undefined;

export const gatewayRestOptionReaders: Record<string, GatewayRestOptionReader> = {
  '--host': readHostname,
  '--hostname': readHostname,
  '--path-prefix': readPathPrefix,
  '--port': readPort,
  '--prefix': readPathPrefix,
  '--ready-file': readReadyFile,
  '--stream-interval-ms': readStreamInterval,
  '--stream-ms': readStreamInterval,
};

function readHostname(
  options: GatewayRestServeParsedOptions,
  flag: string,
  value: string | undefined,
): string | undefined {
  if (!value) return `${flag} requires a value\n`;
  options.hostname = value;
  return undefined;
}

function readPathPrefix(
  options: GatewayRestServeParsedOptions,
  flag: string,
  value: string | undefined,
): string | undefined {
  if (!value) return `${flag} requires a value\n`;
  options.pathPrefix = value;
  return undefined;
}

function readPort(
  options: GatewayRestServeParsedOptions,
  _flag: string,
  value: string | undefined,
): string | undefined {
  const port = parseBoundedInteger(value, 0, 65_535);
  if (port === undefined)
    return value ? `Invalid --port value: ${value}\n` : '--port requires a value\n';
  options.port = port;
  return undefined;
}

function readReadyFile(
  options: GatewayRestServeParsedOptions,
  _flag: string,
  value: string | undefined,
): string | undefined {
  if (!value) return '--ready-file requires a value\n';
  options.readyFile = value;
  return undefined;
}

function readStreamInterval(
  options: GatewayRestServeParsedOptions,
  flag: string,
  value: string | undefined,
): string | undefined {
  const interval = parseBoundedInteger(value, 1, Number.MAX_SAFE_INTEGER);
  if (interval === undefined)
    return value ? `Invalid ${flag} value: ${value}\n` : `${flag} requires a value\n`;
  options.streamIntervalMs = interval;
  return undefined;
}

function parseBoundedInteger(
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}
