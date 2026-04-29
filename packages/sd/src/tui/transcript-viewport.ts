import type { ChatEntry } from './state-readers.js';
import { type TranscriptRow, transcriptRows } from './transcript-window.js';
import { wrapTranscriptRows } from './transcript-wrap.js';

export function visibleWrappedTranscriptRows(
  entries: readonly ChatEntry[],
  viewportRows: number,
  viewportColumns: number,
  scrollOffset: number,
): TranscriptRow[] {
  const capacity = Math.max(1, Math.floor(viewportRows));
  const offset = Math.max(0, Math.floor(scrollOffset));
  const targetRows = capacity + offset;
  const wrapped: TranscriptRow[] = [];

  for (let index = entries.length; index > 0; index -= 1) {
    const entry = entries[index - 1] as ChatEntry;
    wrapped.unshift(...wrapTranscriptRows(transcriptRows([entry]), viewportColumns));
    if (wrapped.length >= targetRows) break;
  }

  const maxOffset = Math.max(0, wrapped.length - capacity);
  const clampedOffset = Math.min(offset, maxOffset);
  const end = Math.max(0, wrapped.length - clampedOffset);
  return wrapped.slice(Math.max(0, end - capacity), end);
}
