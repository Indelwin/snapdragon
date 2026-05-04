import type { SessionMessagePreview } from '@snapdragon-ai/session';
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
  for (const session of context.sessions) await scanMemorySession(context, session);
  writeMemoryWorkerState(context.statePath, context.state);
}

async function scanMemorySession(
  context: MemoryWorkerScanContext,
  session: MemoryWorkerSession,
): Promise<void> {
  context.result.scanned_sessions += 1;
  const watermark = context.state.sessions[session.session_id]?.last_processed_at ?? 0;
  const records = await readRecordsForMemorySession(context, session, watermark);
  if (!records) return;
  const highest = await scanMemoryRecords(context, session.session_id, records, watermark);
  if (highest > watermark)
    context.state.sessions[session.session_id] = { last_processed_at: highest };
}

async function readRecordsForMemorySession(
  context: MemoryWorkerScanContext,
  session: MemoryWorkerSession,
  watermark: number,
): Promise<SessionMessagePreview[] | undefined> {
  try {
    return await readMemoryWorkerMessages({
      path: session.jsonl_path,
      watermark,
      includeAssistant: context.includeAssistant,
      maxEntryChars: context.options.config.memory?.auto?.max_entry_chars,
    });
  } catch (error) {
    context.result.errors.push(
      `Failed to read ${session.jsonl_path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
