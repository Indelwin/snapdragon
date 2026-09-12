import { BoundedTextPreview } from './pi-rpc-text-preview.js';
import type { PiRpcRetentionStats } from './pi-rpc-types.js';

export { BoundedTextPreview } from './pi-rpc-text-preview.js';

export function boundedJsonProjection(
  value: unknown,
  maxBytes: number,
): { value: unknown; stats: PiRpcRetentionStats } {
  const json = JSON.stringify(value);
  if (json === undefined) {
    return {
      value,
      stats: { truncated: false, originalBytes: 0, retainedBytes: 0 },
    };
  }
  const originalBytes = Buffer.byteLength(json);
  if (originalBytes <= maxBytes) {
    return {
      value,
      stats: { truncated: false, originalBytes, retainedBytes: originalBytes },
    };
  }
  const preview = new BoundedTextPreview(maxBytes);
  preview.append(json);
  return {
    value: {
      type: 'pi_rpc_json_preview',
      json: preview.value(),
      originalType: Array.isArray(value) ? 'array' : typeof value,
    },
    stats: preview.stats(),
  };
}
