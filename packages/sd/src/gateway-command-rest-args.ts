export interface RestServeArgs {
  hostname: string;
  port: number;
  pathPrefix: string;
  streamIntervalMs: number;
  start: boolean;
  once: boolean;
  allowRemote: boolean;
}

type ValueParser = (out: RestServeArgs, rest: string[], index: number) => number;
type FlagParser = (out: RestServeArgs) => void;

const DEFAULT_REST_SERVE_ARGS: RestServeArgs = {
  hostname: '127.0.0.1',
  port: 8787,
  pathPrefix: '/v1',
  streamIntervalMs: 1_000,
  start: false,
  once: false,
  allowRemote: false,
};

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

const valueParsers: Record<string, ValueParser> = {
  '--host': (out, rest, index) => assignString(out, 'hostname', rest, index),
  '--hostname': (out, rest, index) => assignString(out, 'hostname', rest, index),
  '--path-prefix': (out, rest, index) => assignString(out, 'pathPrefix', rest, index),
  '--port': (out, rest, index) => assignNumber(out, 'port', rest, index),
  '--prefix': (out, rest, index) => assignString(out, 'pathPrefix', rest, index),
  '--stream-interval-ms': (out, rest, index) => assignNumber(out, 'streamIntervalMs', rest, index),
  '--stream-ms': (out, rest, index) => assignNumber(out, 'streamIntervalMs', rest, index),
};

const flagParsers: Record<string, FlagParser> = {
  '--allow-remote': (out) => {
    out.allowRemote = true;
  },
  '--once': (out) => {
    out.once = true;
  },
  '--start': (out) => {
    out.start = true;
  },
};

export function parseRestServeArgs(rest: string[]): RestServeArgs {
  const out = { ...DEFAULT_REST_SERVE_ARGS };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? '';
    const valueParser = valueParsers[arg];
    if (valueParser) {
      index = valueParser(out, rest, index);
      continue;
    }
    const flagParser = flagParsers[arg];
    if (!flagParser) throw new Error(`Unknown gateway rest serve option: ${arg}`);
    flagParser(out);
  }
  return out;
}

export function assertLocalBind(args: RestServeArgs): void {
  if (args.allowRemote) return;
  if (loopbackHosts.has(args.hostname)) return;
  throw new Error('gateway REST binds to loopback by default; pass --allow-remote to expose it');
}

function assignString<Key extends 'hostname' | 'pathPrefix'>(
  out: RestServeArgs,
  key: Key,
  rest: string[],
  index: number,
): number {
  out[key] = requiredValue(rest, index);
  return index + 1;
}

function assignNumber<Key extends 'port' | 'streamIntervalMs'>(
  out: RestServeArgs,
  key: Key,
  rest: string[],
  index: number,
): number {
  const value = Number(requiredValue(rest, index));
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${rest[index]} value`);
  out[key] = value;
  return index + 1;
}

function requiredValue(rest: string[], index: number): string {
  const value = rest[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${rest[index]} requires a value`);
  return value;
}
