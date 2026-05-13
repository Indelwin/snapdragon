// HTTP TaskSource: universal bridge for gym-style task servers, prod replay
// endpoints, RPC envs (Nethack via HTTP wrapper, in-game NPC dialog services,
// memory-system policy frontends, etc).
//
// Wire protocol (minimal): POST { count, seed?, sourceId } -> { tasks: TaskExample[] }.
// Auth via header callback so credentials stay out of source descriptors.

import type { TaskExample } from './dataset.js';
import type { LearnEnvironment } from './environment.js';
import type { TaskSource, TaskSourceSampleArgs } from './task-source.js';

export interface HttpTaskSourceOptions {
  id: string;
  /** Sample endpoint URL. POST'd with { count, seed?, sourceId }. */
  url: string;
  /** Optional env descriptor (kind: 'external' | 'gateway') for provenance. */
  env?: LearnEnvironment;
  /** Optional fixed size (bounded view); omit for streaming. */
  size?: number;
  /** Auth/header builder, called per request. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Custom request body builder; default sends { count, seed, sourceId }. */
  buildRequest?: (args: TaskSourceSampleArgs & { sourceId: string }) => unknown;
  /** Custom response parser; default reads `{ tasks: TaskExample[] }`. */
  parseResponse?: (payload: unknown) => readonly TaskExample[];
  /** Lifecycle hook for shutting down the remote session. */
  close?: () => Promise<void> | void;
}

export function httpTaskSource(opts: HttpTaskSourceOptions): TaskSource {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      `httpTaskSource(${opts.id}): no fetch implementation available; pass options.fetch`,
    );
  }
  const parse = opts.parseResponse ?? defaultParseResponse;
  const build = opts.buildRequest ?? defaultBuildRequest;

  return {
    id: opts.id,
    kind: 'http',
    size: opts.size,
    async *sample(args: TaskSourceSampleArgs): AsyncIterable<TaskExample> {
      const headers = {
        'content-type': 'application/json',
        ...((await opts.headers?.()) ?? {}),
      };
      const body = JSON.stringify(build({ ...args, sourceId: opts.id }));
      const response = await fetchImpl(opts.url, {
        method: 'POST',
        headers,
        body,
        signal: args.signal,
      });
      if (!response.ok) {
        throw new Error(`httpTaskSource(${opts.id}): ${response.status} ${response.statusText}`);
      }
      const payload = (await response.json()) as unknown;
      for (const task of parse(payload)) {
        if (args.signal?.aborted) return;
        yield task;
      }
    },
    close: opts.close,
  };
}

function defaultBuildRequest(args: TaskSourceSampleArgs & { sourceId: string }): unknown {
  return { sourceId: args.sourceId, count: args.count, seed: args.seed };
}

function defaultParseResponse(payload: unknown): readonly TaskExample[] {
  if (payload && typeof payload === 'object' && 'tasks' in payload) {
    const tasks = (payload as { tasks: unknown }).tasks;
    if (Array.isArray(tasks)) return tasks as readonly TaskExample[];
  }
  throw new Error('httpTaskSource: response missing `tasks` array');
}
