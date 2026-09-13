import { positiveInt } from './gateway-command-number.js';

export interface GatewayJobFenceOptions {
  ok: true;
  leaseId: string;
  attempt: number;
  leaseMs?: number;
  values: string[];
}

export interface GatewayJobFenceError {
  ok: false;
  error: string;
}

export function fenceOptionsFromParts(
  parts: string[],
): GatewayJobFenceOptions | GatewayJobFenceError {
  const options: Omit<GatewayJobFenceOptions, 'ok' | 'leaseId' | 'attempt'> & {
    leaseId?: string;
    attempt?: number;
    error?: string;
  } = { values: [] };
  for (let index = 0; index < parts.length; index += 1) {
    const value = parts[index];
    if (value === '--lease-id') {
      options.leaseId = parts[++index];
    } else if (value === '--attempt') {
      options.attempt = positiveInt(parts[++index]);
      if (!options.attempt) options.error = '--attempt must be a positive integer\n';
    } else if (value === '--lease-ms') {
      options.leaseMs = positiveInt(parts[++index]);
      if (!options.leaseMs) options.error = '--lease-ms must be a positive integer\n';
    } else {
      options.values.push(value);
    }
  }
  if (options.error) return { ok: false, error: options.error };
  if (!options.leaseId || !options.attempt) {
    return { ok: false, error: '--lease-id and --attempt are required\n' };
  }
  return { ok: true, ...options, leaseId: options.leaseId, attempt: options.attempt };
}
