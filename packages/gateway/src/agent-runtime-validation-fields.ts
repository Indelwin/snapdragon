import type { GatewayAgentRuntimeIsolation } from './types.js';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function runtimeId(value: unknown): string {
  const id = stringValue('id', value);
  if (!idPattern.test(id)) {
    throw new Error(
      'gateway agent runtime id must start with a letter or number and contain only letters, numbers, ".", "_", "-", or ":"',
    );
  }
  return id;
}

export function enumValue<T extends string>(
  field: string,
  value: unknown,
  allowed: ReadonlySet<T>,
): T {
  if (typeof value === 'string' && allowed.has(value as T)) return value as T;
  throw new Error(`invalid gateway agent runtime ${field}: ${String(value)}`);
}

export function optionalIsolation(
  value: unknown,
  allowed: ReadonlySet<GatewayAgentRuntimeIsolation>,
): GatewayAgentRuntimeIsolation | undefined {
  return value === undefined || value === null ? undefined : enumValue('isolation', value, allowed);
}

export function stringValue(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`gateway agent runtime ${field} must be a non-empty string`);
  }
  return value.trim();
}

export function stringList(field: string, value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`gateway agent runtime ${field} must be an array`);
  return value.map((item, index) => stringValue(`${field}[${index}]`, item));
}
