import type { ToolCall } from '@snapdragon-ai/host';
import { fallbackArgsJson } from './tool-call-history-fallback.js';
import { boundedJsonValue, parseJson } from './tool-call-json.js';

export function clampToolCallsForHistory(
  calls: readonly ToolCall[] | undefined,
  maxBytes: number,
): ToolCall[] | undefined {
  if (!calls) return undefined;
  return calls.map((call) => ({
    ...call,
    args_json: clampToolArgsJson(call.args_json, maxBytes),
  }));
}

function clampToolArgsJson(argsJson: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return argsJson;
  const originalBytes = Buffer.byteLength(argsJson, 'utf8');
  if (originalBytes <= maxBytes) return argsJson;

  const parsed = parseJson(argsJson);
  if (parsed !== undefined) {
    const bounded = JSON.stringify(
      boundedJsonValue(parsed, Math.max(512, Math.floor(maxBytes / 4))),
    );
    if (Buffer.byteLength(bounded, 'utf8') <= maxBytes) return bounded;
  }

  return fallbackArgsJson(argsJson, originalBytes, maxBytes);
}
