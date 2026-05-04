export function cloneData<T>(value: T): T {
  return cloneValue(value) as T;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isCloneableObject(value)) return value;
  return cloneObject(value);
}

function cloneObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) out[key] = cloneValue(child);
  return out;
}

function isCloneableObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
