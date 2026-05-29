// Process TaskSource: drives a sandboxed child process to produce TaskExamples.
//
// This is the dogfood path for sd-style agents: spawn a configured sandbox /
// local process, send a JSON request on stdin, read newline-delimited TaskExample
// JSON from stdout until `count` tasks have been emitted or the child exits.
//
// Wire protocol (per sample() call):
//   stdin  : single line `{ "count": N, "seed": S?, "sourceId": "..." }`
//   stdout : N lines, each a TaskExample JSON object
//
// The process is short-lived by default (fresh spawn per sample call). For
// long-lived gym-style envs, prefer httpTaskSource.

import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { TaskExample } from './dataset.js';
import type { LearnEnvironment } from './environment.js';
import type { TaskSource, TaskSourceSampleArgs } from './task-source.js';

export interface ProcessTaskSourceOptions {
  id: string;
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /** Optional env descriptor (kind: 'sandbox' | 'local') for provenance. */
  envDescriptor?: LearnEnvironment;
  /** Fixed size for bounded sources; omit for streaming. */
  size?: number;
  /** Per-call timeout in ms (default 60_000). */
  timeoutMs?: number;
}

export function processTaskSource(opts: ProcessTaskSourceOptions): TaskSource {
  return {
    id: opts.id,
    kind: 'process',
    size: opts.size,
    async *sample(args: TaskSourceSampleArgs): AsyncIterable<TaskExample> {
      const child = spawnChild(opts);
      // Wire abort -> immediate SIGTERM so consumers can cut the loop short
      // without waiting for the next line or the per-call timeout.
      const onAbort = () => terminate(child);
      args.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        yield* readTasks(child, opts, args);
      } finally {
        args.signal?.removeEventListener('abort', onAbort);
        terminate(child);
      }
    },
  };
}

function spawnChild(opts: ProcessTaskSourceOptions): ChildProcess {
  return spawn(opts.command, [...(opts.args ?? [])], {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function* readTasks(
  child: ChildProcess,
  opts: ProcessTaskSourceOptions,
  args: TaskSourceSampleArgs,
): AsyncIterable<TaskExample> {
  const request = JSON.stringify({
    sourceId: opts.id,
    count: args.count,
    seed: args.seed,
  });
  child.stdin?.write(`${request}\n`);
  child.stdin?.end();

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const stderr = boundedStderr(4096);
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));

  const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  const timedOut = { value: false };
  const timer = setTimeout(() => {
    timedOut.value = true;
    terminate(child);
  }, timeoutMs);
  let emitted = 0;
  try {
    for await (const line of lines) {
      if (args.signal?.aborted) return;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      yield parseTaskLine(opts.id, trimmed, stderr.snapshot());
      emitted += 1;
      if (emitted >= args.count) return;
    }
  } finally {
    clearTimeout(timer);
  }

  if (timedOut.value) {
    throw new Error(
      `processTaskSource(${opts.id}): timed out after ${timeoutMs}ms (emitted ${emitted}/${args.count}); stderr=${stderr.snapshot().slice(-500)}`,
    );
  }
  if (emitted === 0 && stderr.snapshot().length > 0) {
    throw new Error(
      `processTaskSource(${opts.id}): child produced no tasks; stderr=${stderr.snapshot().slice(0, 500)}`,
    );
  }
}

/** Ring-buffered stderr capture. Keeps at most `limit` UTF-8 chars. */
function boundedStderr(limit: number): { push(s: string): void; snapshot(): string } {
  let buf = '';
  return {
    push(s) {
      buf = (buf + s).slice(-limit);
    },
    snapshot() {
      return buf;
    },
  };
}

function parseTaskLine(id: string, line: string, stderrTail: string): TaskExample {
  try {
    return JSON.parse(line) as TaskExample;
  } catch (error) {
    throw new Error(
      `processTaskSource(${id}): malformed TaskExample line: ${(error as Error).message}; stderr=${stderrTail.slice(-200)}`,
    );
  }
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // child may already be gone
  }
}
