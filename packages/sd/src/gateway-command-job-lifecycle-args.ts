export interface GatewayJobAcquireOptions {
  queue: string;
  worker?: string;
  leaseMs?: number;
  error?: string;
}

export function acquireOptionsFromParts(parts: string[]): GatewayJobAcquireOptions {
  const positionals: string[] = [];
  const options = collectAcquireParts(parts, positionals);
  if (options.error) return { ...options, queue: options.queue ?? 'default' };
  options.queue ??= positionals.length > 1 ? positionals[0] : 'default';
  options.worker ??= positionals.length > 1 ? positionals[1] : positionals[0];
  return { queue: options.queue, worker: options.worker, leaseMs: options.leaseMs };
}

export function resultFromParts(parts: string[]): unknown {
  const text = parts.join(' ');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { summary: text };
  }
}

function collectAcquireParts(
  parts: string[],
  positionals: string[],
): Partial<GatewayJobAcquireOptions> {
  const options: Partial<GatewayJobAcquireOptions> = {};
  for (let index = 0; index < parts.length; index += 1) {
    const value = parts[index];
    if (value === '--queue') {
      options.queue = parts[++index];
    } else if (value === '--worker') {
      options.worker = parts[++index];
    } else if (value === '--lease-ms') {
      const parsed = positiveInt(parts[++index]);
      if (!parsed) return { ...options, error: '--lease-ms must be positive\n' };
      options.leaseMs = parsed;
    } else {
      positionals.push(value);
    }
  }
  return options;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
