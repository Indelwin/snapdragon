// Internal helpers shared by the webtools tool wrappers.
//
// Kept small and dependency-free so each tool-group module can stay focused.

import type { JsonObject, JsonValue } from '@snapdragon-ai/core';

export interface HttpDefaults {
  userAgent?: string;
  timeoutMs?: number;
}

export function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}

export function jsonData(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function objectArg(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (!isPlainRecord(value)) throw new Error('Tool arguments must be an object');
  return value;
}

export function stringArg(args: Record<string, unknown>, key: string): string {
  const value = readOptional(args, key, 'string') as string | undefined;
  if (value === undefined || value.length === 0) {
    throw new Error(`Expected non-empty string argument: ${key}`);
  }
  return value;
}

export function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  return readOptional(args, key, 'string') as string | undefined;
}

export function optionalNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = readOptional(args, key, 'number') as number | undefined;
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new Error(`Expected finite number argument: ${key}`);
  return value;
}

export function optionalBooleanArg(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  return readOptional(args, key, 'boolean') as boolean | undefined;
}

// --- private ---

type Primitive = 'string' | 'number' | 'boolean';

const TYPE_GUARDS: Record<Primitive, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
};

function readOptional(args: Record<string, unknown>, key: string, expected: Primitive): unknown {
  const value = args[key];
  if (value == null) return undefined;
  if (!TYPE_GUARDS[expected](value)) throw new Error(`Expected ${expected} argument: ${key}`);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object') return false;
  return !Array.isArray(value);
}
