import type { JsonObject, JsonValue } from '@snapdragon-ai/core';
import {
  isTodoPriority,
  isTodoStatus,
  type SdTodoItem,
  type SdTodoStatus,
  TODO_PRIORITIES,
  TODO_STATUSES,
} from './todo-types.js';

export function objectArg(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

export function objectArgOrEmpty(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return objectArg(value);
}

export function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string argument: ${key}`);
  }
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function optionalStatus(value: unknown): SdTodoStatus | undefined {
  if (value === undefined) return undefined;
  if (isTodoStatus(value)) return value;
  throw new Error(`Expected TODO status: ${TODO_STATUSES.join(', ')}`);
}

export function optionalPriority(value: unknown): SdTodoItem['priority'] | undefined {
  if (value === undefined) return undefined;
  if (isTodoPriority(value)) return value;
  throw new Error(`Expected TODO priority: ${TODO_PRIORITIES.join(', ')}`);
}

export function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}

export function jsonData(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
