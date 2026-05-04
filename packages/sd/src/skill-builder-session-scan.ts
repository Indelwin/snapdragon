import { readMessagePreviews } from '@snapdragon-ai/session';
import type { SdConfig, SdSkillBuilderConfig } from './config.js';
import { runtimeSessionStore } from './runtime-session.js';
import { createNgramStats, ingestSessionIntoStats } from './skill-builder-detect.js';
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
  const sessions = runtimeSessionStore(config)
    .list()
    .slice(0, cfg.lookback_sessions ?? 10);
  const stats = createNgramStats();
  for (const session of sessions) {
    result.scanned_sessions += 1;
    await scanOneSession(session.session_id, session.jsonl_path, state, result, stats);
  }
  return stats;
}

async function scanOneSession(
  sessionId: string,
  path: string,
  state: BuilderState,
  result: SdSkillBuilderScanResult,
  stats: ReturnType<typeof createNgramStats>,
): Promise<void> {
  const watermark = state.sessions[sessionId]?.last_processed_at ?? 0;
  const records = await readSkillBuilderRecords(path, result);
  const newRecords = records.filter((record) => record.created_at > watermark);
  if (newRecords.length === 0) return;
  ingestSessionIntoStats(newRecords, sessionId, stats);
  updateWatermark(state, sessionId, watermark, newRecords);
}

async function readSkillBuilderRecords(
  path: string,
  result: SdSkillBuilderScanResult,
): Promise<SkillBuilderMessageRecord[]> {
  try {
    return (await readMessagePreviews(path, previewOptions())).map(skillBuilderRecord);
  } catch (error) {
    result.errors.push(
      `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
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
  record: Awaited<ReturnType<typeof readMessagePreviews>>[number],
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
): void {
  const highest = records.reduce((max, r) => (r.created_at > max ? r.created_at : max), watermark);
  if (highest > watermark) state.sessions[sessionId] = { last_processed_at: highest };
}
