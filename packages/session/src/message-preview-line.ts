import type { SessionMessagePreview } from './message-preview-types.js';

export interface MessagePreviewLineState {
  records: SessionMessagePreview[];
  linePrefix: Buffer[];
  retainedBytes: number;
  retainLimit: number;
}

export function retainPreviewLineBytes(state: MessagePreviewLineState, bytes: Buffer): void {
  const remaining = state.retainLimit - state.retainedBytes;
  if (remaining <= 0 || bytes.length === 0) return;
  const retained = bytes.subarray(0, Math.min(remaining, bytes.length));
  state.linePrefix.push(Buffer.from(retained));
  state.retainedBytes += retained.length;
}

export function takePreviewLine(state: MessagePreviewLineState): string | undefined {
  const line =
    state.retainedBytes > 0
      ? Buffer.concat(state.linePrefix, state.retainedBytes).toString('utf8').trim()
      : '';
  state.linePrefix = [];
  state.retainedBytes = 0;
  return line || undefined;
}
