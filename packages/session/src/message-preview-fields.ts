import { fieldValueIndex } from './message-preview-field-index.js';
import { readStringPreview } from './message-preview-string.js';

export function extractStringField(line: string, field: string): string | undefined {
  const valueIndex = fieldValueIndex(line, field);
  if (valueIndex < 0 || line[valueIndex] !== '"') return undefined;
  return readStringPreview(line, valueIndex, 200);
}
