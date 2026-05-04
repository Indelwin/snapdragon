import { fieldValueIndex } from './message-preview-field-index.js';

export function extractArrayField(line: string, field: string): string | undefined {
  const valueIndex = fieldValueIndex(line, field);
  if (valueIndex < 0 || line[valueIndex] !== '[') return undefined;
  return scanArray(line, valueIndex);
}

function scanArray(line: string, start: number): string | undefined {
  const state = { depth: 0, inString: false, escaped: false };
  for (let index = start; index < line.length; index += 1) {
    const done = scanArrayChar(state, line[index]);
    if (done) return line.slice(start, index + 1);
  }
  return undefined;
}

function scanArrayChar(
  state: { depth: number; inString: boolean; escaped: boolean },
  ch: string | undefined,
): boolean {
  if (!ch) return false;
  if (state.inString) return scanStringArrayChar(state, ch);
  scanArrayControlChar(state, ch);
  return state.depth === 0;
}

function scanArrayControlChar(state: { depth: number; inString: boolean }, ch: string): void {
  if (ch === '"') state.inString = true;
  if (ch === '[') state.depth += 1;
  if (ch === ']') state.depth -= 1;
}

function scanStringArrayChar(state: { inString: boolean; escaped: boolean }, ch: string): false {
  if (state.escaped) state.escaped = false;
  else if (ch === '\\') state.escaped = true;
  else if (ch === '"') state.inString = false;
  return false;
}
