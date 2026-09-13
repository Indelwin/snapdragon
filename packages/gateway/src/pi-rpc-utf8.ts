const COMPACT_FRAGMENT_COUNT = 64;

export function compactBuffers(fragments: Buffer[], bytes: number): Buffer[] {
  return fragments.length >= COMPACT_FRAGMENT_COUNT ? [Buffer.concat(fragments, bytes)] : fragments;
}

export function utf8Prefix(value: Buffer, maxBytes: number): Buffer {
  if (value.length <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && isContinuationByte(value[end] ?? 0)) end--;
  return value.subarray(0, end);
}

export function utf8Suffix(value: Buffer, maxBytes: number): Buffer {
  if (value.length <= maxBytes) return value;
  let start = value.length - maxBytes;
  while (start < value.length && isContinuationByte(value[start] ?? 0)) start++;
  return value.subarray(start);
}

function isContinuationByte(value: number): boolean {
  return (value & 0xc0) === 0x80;
}
