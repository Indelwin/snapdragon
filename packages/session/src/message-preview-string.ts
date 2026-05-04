export function readStringPreview(line: string, quoteIndex: number, maxChars: number): string {
  let out = '';
  for (let i = quoteIndex + 1; i < line.length && out.length < maxChars; i += 1) {
    const result = readStringChar(line, i);
    if (result.done) break;
    out += result.value;
    i = result.index;
  }
  return out;
}

function readStringChar(
  line: string,
  index: number,
): { done: true; value: ''; index: number } | { done: false; value: string; index: number } {
  const ch = line[index];
  if (ch === '"') return { done: true, value: '', index };
  if (ch !== '\\') return { done: false, value: ch ?? '', index };
  return readEscapedChar(line, index);
}

function readEscapedChar(line: string, index: number): ReturnType<typeof readStringChar> {
  const escaped = line[index + 1];
  if (!escaped) return { done: true, value: '', index };
  if (escaped === 'u') return readUnicodeEscape(line, index + 1);
  return { done: false, value: simpleEscape(escaped), index: index + 1 };
}

function readUnicodeEscape(line: string, escapeIndex: number): ReturnType<typeof readStringChar> {
  const hex = line.slice(escapeIndex + 1, escapeIndex + 5);
  if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { done: false, value: 'u', index: escapeIndex };
  return {
    done: false,
    value: String.fromCharCode(Number.parseInt(hex, 16)),
    index: escapeIndex + 4,
  };
}

function simpleEscape(value: string): string {
  return SIMPLE_ESCAPES[value] ?? value;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};
