import { relative, resolve } from 'node:path';

export function resolveInside(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, path);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel.startsWith('..') || rel === '..' || rel.startsWith(`..${separatorHint()}`)) {
    throw new Error(`Path escapes sandbox: ${path}`);
  }
  return resolvedPath;
}

export function objectArg(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

export function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected non-empty string argument: ${key}`);
  }
  return value;
}

export function optionalNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected number argument: ${key}`);
  }
  return value;
}

function separatorHint(): string {
  return '/';
}
