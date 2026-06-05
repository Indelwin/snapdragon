import type { GatewayWorldSnapshotOptions } from '@snapdragon-ai/gateway';

const INSPECT_SECTIONS: GatewayWorldSnapshotOptions['sections'] = [
  'services',
  'agentRuntimes',
  'workers',
  'workerProcesses',
  'jobs',
  'logs',
  'leases',
  'queueDepths',
  'sandboxes',
];

export function inspectOptionsFromParts(parts: string[]): GatewayWorldSnapshotOptions {
  const parsed = parseInspectParts(parts);
  return {
    sections: INSPECT_SECTIONS,
    target: parsed.target,
    queue: parsed.option('queue'),
    runtimeId: parsed.option('runtime', 'runtimeId'),
    service: parsed.option('service'),
    worker: parsed.option('worker', 'workerId'),
    capability: parsed.option('capability'),
    jobKind: parsed.option('kind', 'jobKind'),
    jobState: state(parsed.option('state', 'jobState'), [
      'pending',
      'running',
      'completed',
      'failed',
      'cancelled',
    ]),
    workerState: state(parsed.option('workerState'), ['idle', 'running', 'offline']),
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
