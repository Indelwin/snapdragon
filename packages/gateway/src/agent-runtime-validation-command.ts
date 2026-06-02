import { stringList, stringValue } from './agent-runtime-validation-fields.js';
import { stringRecord } from './agent-runtime-validation-record.js';
import type { GatewayServiceWorkerSpec } from './types.js';

export function normalizeRuntimeCommand(value: unknown): GatewayServiceWorkerSpec | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('gateway agent runtime command must be an object');
  }
  const raw = value as Record<string, unknown>;
  const command = stringValue('command.command', raw.command);
  const args = stringList('command.args', raw.args);
  const cwd = optionalString('command.cwd', raw.cwd);
  const env =
    raw.env === undefined || raw.env === null ? undefined : stringRecord('command.env', raw.env);
  return { command, args, cwd, env };
}

function optionalString(field: string, value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : stringValue(field, value);
}
