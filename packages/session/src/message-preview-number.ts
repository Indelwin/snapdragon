import { fieldValueIndex } from './message-preview-field-index.js';

export function extractNumberField(line: string, field: string): number | undefined {
  const valueIndex = fieldValueIndex(line, field);
  if (valueIndex < 0) return undefined;
  const match = /^-?\d+(?:\.\d+)?/.exec(line.slice(valueIndex));
  return match ? finiteNumber(match[0]) : undefined;
}

function finiteNumber(raw: string): number | undefined {
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
