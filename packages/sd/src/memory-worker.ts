import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { memoryShouldAutoCapture } from '@snapdragon-ai/content';
import { readRecords, type SessionMessageRecord } from '@snapdragon-ai/session';
import type {
  SdBackgroundContext,
  SdBackgroundService,
  SdBackgroundServiceResult,
} from './background.js';
import type { SdConfig } from './config.js';
import type { SdMemoryProvider } from './memory.js';
import { resolveSdMemoryPath } from './memory.js';
import type { SdProfileInfo } from './profile.js';
import { runtimeSessionStore } from './runtime-session.js';

/**
 * Tracks the highest-watermark message timestamp processed for each session,
 * so the worker never re-emits a memory entry for the same turn.
 */
interface WorkerState {
  version: 1;
  sessions: Record<string, { last_processed_at: number }>;
}

export interface SdMemoryWorkerOptions {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  /** Override "now" for tests. */
  now?: () => number;
  /** Optional logger; defaults to no-op. */
  log?: (line: string) => void;
}

export interface SdMemoryWorkerScanResult {
  scanned_sessions: number;
  considered_messages: number;
  captured: number;
  skipped_duplicates: number;
  errors: string[];
}

const STATE_FILENAME = '.worker-state.json';

/**
 * Run a single pass of the background worker. Pure with respect to wall-clock
 * (apart from `Date.now`), idempotent across calls thanks to the watermark.
 */
export async function runSdMemoryWorkerOnce(
  options: SdMemoryWorkerOptions,
): Promise<SdMemoryWorkerScanResult> {
  const result: SdMemoryWorkerScanResult = {
    scanned_sessions: 0,
    considered_messages: 0,
    captured: 0,
    skipped_duplicates: 0,
    errors: [],
  };
  const memoryConfig = options.config.memory;
  if (memoryConfig?.enabled === false) return result;
  if (memoryConfig?.authoring === false) return result;

  const workerCfg = memoryConfig?.worker ?? {};
  const lookback = workerCfg.lookback_sessions ?? 10;
  const includeAssistant = workerCfg.include_assistant ?? false;

  const memoryPath = resolveSdMemoryPath(options.config, options.profile);
  const stateDir = dirname(memoryPath);
  const statePath = join(stateDir, STATE_FILENAME);
  const state = readState(statePath);

  const sessions = runtimeSessionStore(options.config).list().slice(0, lookback);
  const existingHashes = collectExistingHashes(memoryPath);

  for (const session of sessions) {
    result.scanned_sessions += 1;
    const watermark = state.sessions[session.session_id]?.last_processed_at ?? 0;
    let highest = watermark;
    let records: SessionMessageRecord[] = [];
    try {
      records = readRecords(session.jsonl_path).filter(
        (record): record is SessionMessageRecord =>
          record.type === 'message' && record.created_at > watermark,
      );
    } catch (error) {
      result.errors.push(
        `Failed to read ${session.jsonl_path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    for (const record of records) {
      result.considered_messages += 1;
      if (record.created_at > highest) highest = record.created_at;
      if (record.role !== 'user') continue;
      const userInput = textFromContent(record.content);
      if (!userInput) continue;

      const decision = memoryShouldAutoCapture(
        { userInput },
        {
          enabled: memoryConfig?.auto?.enabled,
          triggers: memoryConfig?.auto?.triggers,
          maxEntryChars: memoryConfig?.auto?.max_entry_chars,
          includeAssistant,
        },
      );
      if (!decision.capture || !decision.extracted) continue;

      const content = decision.extracted;
      const hash = hashContent(content);
      if (existingHashes.has(hash)) {
        result.skipped_duplicates += 1;
        continue;
      }
      try {
        const appended = await Promise.resolve(
          options.memory.append({
            title: `Auto: ${truncateForTitle(decision.extracted)}`,
            content,
            tags: ['auto', 'tentative', 'worker', decision.trigger ?? 'auto'],
            source: `sd.worker:${session.session_id}`,
          }),
        );
        if (appended.success) {
          existingHashes.add(hash);
          result.captured += 1;
          options.log?.(
            `[memory-worker] captured from ${session.session_id} trigger="${decision.trigger}"`,
          );
        } else {
          result.errors.push(appended.error ?? 'append failed');
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (highest > watermark) {
      state.sessions[session.session_id] = { last_processed_at: highest };
    }
  }

  writeState(statePath, state);
  return result;
}

export interface SdMemoryWorkerHandle {
  stop(): void;
  /** Resolves once any in-flight scan finishes. */
  flush(): Promise<void>;
}

/**
 * Start a background timer that runs the worker on an interval. Returns a
 * handle that lets the caller stop the worker on shutdown. The first scan is
 * scheduled (not run synchronously) so callers can rely on this not blocking.
 */
export function startSdMemoryWorker(
  options: SdMemoryWorkerOptions,
): SdMemoryWorkerHandle | undefined {
  const cfg = options.config.memory?.worker;
  if (!cfg?.enabled) return undefined;
  const interval = cfg.interval_ms ?? 5 * 60 * 1000;
  if (!Number.isFinite(interval) || interval <= 0) return undefined;

  let stopped = false;
  let inflight: Promise<void> = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    inflight = runSdMemoryWorkerOnce(options)
      .then(() => undefined)
      .catch((error) => {
        options.log?.(
          `[memory-worker] scan failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    await inflight;
  };

  const timer = setInterval(() => {
    void tick();
  }, interval);
  // Don't keep the Node event loop alive just for the worker.
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    async flush() {
      await inflight;
    },
  };
}

/**
 * Wrap the memory worker as an `SdBackgroundService` so it slots into the
 * generic background gateway. The service's enabled/interval values are read
 * lazily from the runtime config — same source of truth as the legacy
 * `startSdMemoryWorker`. Errors are surfaced via the gateway's status surface
 * rather than thrown.
 */
export function memoryWorkerService(): SdBackgroundService {
  return {
    name: 'memory-worker',
    enabled(ctx: SdBackgroundContext) {
      const cfg = ctx.config.memory;
      if (cfg?.enabled === false) return false;
      if (cfg?.authoring === false) return false;
      return cfg?.worker?.enabled === true;
    },
    intervalMs(ctx: SdBackgroundContext) {
      return ctx.config.memory?.worker?.interval_ms ?? 5 * 60 * 1000;
    },
    async runOnce(ctx: SdBackgroundContext): Promise<SdBackgroundServiceResult> {
      const result = await runSdMemoryWorkerOnce({
        config: ctx.config,
        memory: ctx.memory,
        profile: ctx.profile,
        log: ctx.log,
      });
      return {
        summary:
          result.captured > 0
            ? `captured ${result.captured} from ${result.scanned_sessions} session(s)`
            : `scanned ${result.scanned_sessions}, no new captures`,
        metrics: {
          scanned_sessions: result.scanned_sessions,
          considered_messages: result.considered_messages,
          captured: result.captured,
          skipped_duplicates: result.skipped_duplicates,
          errors: result.errors.length,
        },
      };
    },
  };
}

function readState(path: string): WorkerState {
  if (!existsSync(path)) return { version: 1, sessions: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WorkerState;
    if (parsed?.version === 1 && parsed.sessions && typeof parsed.sessions === 'object') {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { version: 1, sessions: {} };
}

function writeState(path: string, state: WorkerState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, undefined, 2), 'utf8');
  renameSync(tmp, path);
}

function collectExistingHashes(memoryPath: string): Set<string> {
  const hashes = new Set<string>();
  if (!existsSync(memoryPath)) return hashes;
  const raw = readFileSync(memoryPath, 'utf8');
  for (const section of raw.split(/\n(?=##\s+)/g)) {
    if (!section.startsWith('## ')) continue;
    const body = section.split(/\n\n/).slice(1).join('\n\n').trim();
    if (body) hashes.add(hashContent(body));
  }
  return hashes;
}

function hashContent(value: string): string {
  // Tiny FNV-1a 32-bit hash; we don't need crypto strength, just stable dedupe.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function textFromContent(content: SessionMessageRecord['content']): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: 'text'; text: string } => block?.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function truncateForTitle(value: string, max = 60): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 1).trimEnd()}…`;
}
