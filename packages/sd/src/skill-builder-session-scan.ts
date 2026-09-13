import { type MessagePreviewBatch, readMessagePreviewBatch } from '@snapdragon-ai/session';
import type { SdConfig, SdSkillBuilderConfig } from './config.js';
import { runtimeSessionStore } from './runtime-session.js';
import type { NgramStats } from './skill-builder-detect.js';
import { ingestSessionDeltaIntoStats } from './skill-builder-ngram-ingest.js';
import { restoreNgramStats, snapshotNgramStats } from './skill-builder-stats-state.js';
import { retainSkillBuilderTail } from './skill-builder-tail.js';
import type {
  BuilderState,
  SdSkillBuilderScanResult,
  SkillBuilderMessageRecord,
} from './skill-builder-types.js';

export async function scanSessionsForNgrams(
  config: SdConfig,
  state: BuilderState,
  result: SdSkillBuilderScanResult,
  cfg: SdSkillBuilderConfig,
) {
  const listedSessions = runtimeSessionStore(config)
    .list()
    .slice(0, cfg.lookback_sessions ?? 10);
  const sessions = rotateSessions(listedSessions, state.next_session_id);
  const stats = restoreNgramStats(state.ngram_stats);
  const budget = {
    records: positiveBudget(cfg.max_records_per_pass, 500),
    bytes: positiveBudget(cfg.max_bytes_per_pass, 4 * 1024 * 1024),
  };
  for (const [index, session] of sessions.entries()) {
    if (budget.records <= 0 || budget.bytes <= 0) break;
    result.scanned_sessions += 1;
    await scanOneSession(session.session_id, session.jsonl_path, state, result, stats, budget);
    state.next_session_id = sessions[(index + 1) % sessions.length]?.session_id;
  }
  state.ngram_stats = snapshotNgramStats(stats);
  return stats;
}

function rotateSessions<T extends { session_id: string }>(
  sessions: T[],
  nextSessionId: string | undefined,
): T[] {
  const start = nextSessionId
    ? sessions.findIndex((session) => session.session_id === nextSessionId)
    : 0;
  if (start <= 0) return sessions;
  return [...sessions.slice(start), ...sessions.slice(0, start)];
}

async function scanOneSession(
  sessionId: string,
  path: string,
  state: BuilderState,
  result: SdSkillBuilderScanResult,
  stats: NgramStats,
  budget: { records: number; bytes: number },
): Promise<void> {
  const previous = state.sessions[sessionId];
  const watermark = previous?.last_processed_at ?? 0;
  const batch = await readSkillBuilderRecords(
    path,
    result,
    previous?.byte_offset ?? 0,
    previous?.skip_partial_line ?? false,
    budget,
  );
  budget.records -= batch.scannedRecords;
  budget.bytes -= batch.scannedBytes;
  const records = batch.records.map(skillBuilderRecord);
  const newRecords =
    previous && previous.byte_offset === undefined
      ? records.filter((record) => record.created_at > watermark)
      : records;
  const previousTail = state.session_tails?.[sessionId] ?? [];
  ingestSessionDeltaIntoStats(previousTail, newRecords, sessionId, stats);
  state.session_tails ??= {};
  state.session_tails[sessionId] = retainSkillBuilderTail([...previousTail, ...newRecords]);
  updateWatermark(state, sessionId, watermark, newRecords, batch.nextOffset, batch.skipPartialLine);
}

async function readSkillBuilderRecords(
  path: string,
  result: SdSkillBuilderScanResult,
  byteOffset: number,
  skipPartialLine: boolean,
  budget: { records: number; bytes: number },
): Promise<MessagePreviewBatch> {
  try {
    return readMessagePreviewBatch(path, {
      ...previewOptions(),
      startOffset: byteOffset,
      skipPartialLine,
      maxRecords: budget.records,
      maxBytes: budget.bytes,
    });
  } catch (error) {
    result.errors.push(
      `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      records: [],
      nextOffset: byteOffset,
      scannedRecords: 0,
      scannedBytes: 0,
      skipPartialLine,
      done: true,
    };
  }
}

function previewOptions() {
  return {
    roles: ['user', 'assistant'] as const,
    includeContent: true,
    includeToolCalls: true,
    maxContentChars: 500,
    maxArgsChars: 240,
  };
}

function skillBuilderRecord(
  record: MessagePreviewBatch['records'][number],
): SkillBuilderMessageRecord {
  return {
    role: record.role,
    created_at: record.created_at,
    content: record.contentText,
    tool_calls: record.tool_calls?.map((call) => ({
      name: call.name,
      args_json: call.args_json,
    })),
  };
}

function updateWatermark(
  state: BuilderState,
  sessionId: string,
  watermark: number,
  records: SkillBuilderMessageRecord[],
  byteOffset: number,
  skipPartialLine: boolean,
): void {
  const highest = records.reduce((max, r) => (r.created_at > max ? r.created_at : max), watermark);
  state.sessions[sessionId] = {
    last_processed_at: highest,
    byte_offset: byteOffset,
    skip_partial_line: skipPartialLine,
  };
}

function positiveBudget(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
