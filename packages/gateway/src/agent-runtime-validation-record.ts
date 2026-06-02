import { stringValue } from './agent-runtime-validation-fields.js';

export function stringRecord(field: string, value: unknown): Record<string, string> {
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`gateway agent runtime ${field} must be an object`);
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.trim() === '') throw new Error(`gateway agent runtime ${field} has an empty key`);
    record[key] = stringValue(`${field}.${key}`, item);
  }
  return record;
}
