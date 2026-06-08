import type { GatewayJobState, GatewayServiceState } from '@snapdragon-ai/gateway';

export interface GatewayInspectOptions {
  target?: string;
  queue?: string;
  runtimeId?: string;
  service?: string;
  workerId?: string;
  capability?: string;
  jobKind?: string;
  jobState?: GatewayJobState;
  serviceState?: GatewayServiceState;
  logLimit: number;
}

export function inspectOptionsFromParts(parts: string[]): GatewayInspectOptions {
  const parsed = parseInspectParts(parts);
  return {
    target: parsed.target,
    queue: parsed.option('queue'),
    runtimeId: parsed.option('runtime', 'runtimeId'),
    service: parsed.option('service'),
    workerId: parsed.option('worker', 'workerId'),
    capability: parsed.option('capability'),
    jobKind: parsed.option('kind', 'jobKind'),
    jobState: state(parsed.option('state', 'jobState'), [
      'pending',
      'running',
      'completed',
      'failed',
      'cancelled',
    ]),
    serviceState: state(parsed.option('serviceState'), [
      'starting',
      'running',
      'stopped',
      'failed',
    ]),
    logLimit: positiveInt(parsed.option('limit', 'logLimit')) ?? 20,
  };
}

function parseInspectParts(parts: string[]) {
  const options = new Map<string, string[]>();
  let target: string | undefined;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (!part.startsWith('--')) {
      target ??= part;
      continue;
    }
    const value = parts[i + 1];
    if (!value || value.startsWith('--')) continue;
    const key = normalizeOptionName(part.slice(2));
    options.set(key, [...(options.get(key) ?? []), value]);
    i += 1;
  }
  return {
    target,
    option: (...keys: string[]) => firstOption(options, keys),
  };
}

function firstOption(options: Map<string, string[]>, keys: string[]): string | undefined {
  for (const key of keys.map(normalizeOptionName)) {
    const value = options.get(key)?.[0];
    if (value) return value;
  }
  return undefined;
}

function normalizeOptionName(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function state<State extends string>(
  value: string | undefined,
  allowed: State[],
): State | undefined {
  return value && allowed.includes(value as State) ? (value as State) : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
