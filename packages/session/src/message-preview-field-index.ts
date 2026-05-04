export function fieldValueIndex(line: string, field: string): number {
  const index = line.indexOf(`"${field}"`);
  if (index < 0) return -1;
  const colon = line.indexOf(':', index + field.length + 2);
  return colon < 0 ? -1 : skipWhitespace(line, colon + 1);
}

function skipWhitespace(line: string, start: number): number {
  let index = start;
  while (/\s/.test(line[index] ?? '')) index += 1;
  return index;
}
