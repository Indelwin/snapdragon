import type { MessagePreviewBatch, SessionMessagePreview } from '@snapdragon-ai/session';
import { captureMemoryRecord } from './memory-worker-capture.js';
import {
  type MemoryWorkerScanContext,
  type MemoryWorkerSession,
  memoryWorkerScanContext,
} from './memory-worker-context.js';
import { readMemoryWorkerMessages } from './memory-worker-session-scan.js';
import { writeMemoryWorkerState } from './memory-worker-state.js';
import type { SdMemoryWorkerOptions, SdMemoryWorkerScanResult } from './memory-worker-types.js';

export async function runMemoryWorkerScan(
  options: SdMemoryWorkerOptions,
  result: SdMemoryWorkerScanResult,
): Promise<void> {
  const context = memoryWorkerScanContext(options, result);
  for (const [index, session] of context.sessions.entries()) {
    if (context.remainingRecords <= 0 || context.remainingBytes <= 0) break;
    await scanMemorySession(context, session);
    context.state.next_session_id =
      context.sessions[(index + 1) % context.sessions.length]?.session_id;
  }
  writeMemoryWorkerState(context.statePath, context.state);
}

async function scanMemorySession(
  context: MemoryWorkerScanContext,
  session: MemoryWorkerSession,
): Promise<void> {
  context.result.scanned_sessions += 1;
  const previous = context.state.sessions[session.session_id];
  const watermark = previous?.last_processed_at ?? 0;
  const batch = await readRecordsForMemorySession(
    context,
    session,
    previous?.byte_offset ?? 0,
    previous?.skip_partial_line ?? false,
  );
  if (!batch) return;
  consumeBudget(context, batch);
  const records =
    previous && previous.byte_offset === undefined
      ? batch.records.filter((record) => record.created_at > watermark)
      : batch.records;
  const highest = await scanMemoryRecords(context, session.session_id, records, watermark);
  context.state.sessions[session.session_id] = {
    last_processed_at: highest,
    byte_offset: batch.nextOffset,
    skip_partial_line: batch.skipPartialLine,
  };
}

async function readRecordsForMemorySession(
  context: MemoryWorkerScanContext,
  session: MemoryWorkerSession,
  byteOffset: number,
  skipPartialLine: boolean,
): Promise<MessagePreviewBatch | undefined> {
  try {
    return await readMemoryWorkerMessages({
      path: session.jsonl_path,
      byteOffset,
      skipPartialLine,
      maxRecords: context.remainingRecords,
      maxBytes: context.remainingBytes,
      includeAssistant: context.includeAssistant,
      maxEntryChars: context.options.config.memory?.auto?.max_entry_chars,
    });
  } catch (error) {
    context.result.errors.push(
      `Failed to read ${session.jsonl_path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function consumeBudget(context: MemoryWorkerScanContext, batch: MessagePreviewBatch): void {
  context.remainingRecords -= batch.scannedRecords;
  context.remainingBytes -= batch.scannedBytes;
  context.result.scanned_records += batch.scannedRecords;
  context.result.scanned_bytes += batch.scannedBytes;
}

async function scanMemoryRecords(
  context: MemoryWorkerScanContext,
  sessionId: string,
  records: SessionMessagePreview[],
  watermark: number,
): Promise<number> {
  let highest = watermark;
  for (const record of records) {
    context.result.considered_messages += 1;
    highest = Math.max(highest, record.created_at);
    await captureMemoryRecord(context, sessionId, record);
  }
  return highest;
}
