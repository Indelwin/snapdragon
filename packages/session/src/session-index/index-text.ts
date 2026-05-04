export const MAX_INDEX_CONTENT_CHARS = 64_000;
export const MAX_INDEX_METADATA_CHARS = 16_000;

export function capIndexText(value: string, maxChars = MAX_INDEX_CONTENT_CHARS): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 34)).trimEnd()}\n[indexed preview truncated]`;
}

export function appendIndexPart(out: string, part: string): string {
  if (!part) return out;
  return out ? `${out}\n${part}` : part;
}
