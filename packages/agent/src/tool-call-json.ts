const MAX_OBJECT_KEYS = 40;
const MAX_ARRAY_ITEMS = 40;

export function boundedJsonValue(value: unknown, maxStringChars: number): unknown {
  if (typeof value === 'string') return boundedString(value, maxStringChars);
  if (Array.isArray(value)) return boundedArray(value, maxStringChars);
  if (value && typeof value === 'object') return boundedObject(value, maxStringChars);
  return value;
}

export function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function boundedObject(value: object, maxStringChars: number): Record<string, unknown> {
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  const out: Record<string, unknown> = {};
  for (const [key, child] of entries) out[key] = boundedJsonValue(child, maxStringChars);
  const omitted = Object.keys(value).length - entries.length;
  if (omitted > 0) out._snapdragon_omitted_keys = omitted;
  return out;
}

function boundedArray(value: readonly unknown[], maxStringChars: number): unknown[] {
  const out = value.slice(0, MAX_ARRAY_ITEMS).map((item) => boundedJsonValue(item, maxStringChars));
  const omitted = value.length - out.length;
  if (omitted > 0) out.push({ _snapdragon_omitted_items: omitted });
  return out;
}

function boundedString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trimEnd()}\n[tool call argument truncated for history: ${
    value.length - maxChars
  } more char(s)]`;
}
