import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { SdConfig } from '../src/config.js';
import { resolveSessionIndexForWorker } from '../src/gateway-worker.ts';

describe('resolveSessionIndexForWorker', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sd-gw-worker-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns no index when service is not session-index', () => {
    const config = {} as SdConfig;
    const result = resolveSessionIndexForWorker('memory-worker', config);
    assert.equal(result.disabled, false);
    assert.equal(result.disabled === false ? result.index : 'x', undefined);
  });

  it('signals disabled when sessions.enabled is false', () => {
    const config = { sessions: { enabled: false } } as unknown as SdConfig;
    const result = resolveSessionIndexForWorker('session-index', config);
    assert.equal(result.disabled, true);
  });

  it('signals disabled when sessions.index.enabled is false', () => {
    const config = { sessions: { index: { enabled: false } } } as unknown as SdConfig;
    const result = resolveSessionIndexForWorker('session-index', config);
    assert.equal(result.disabled, true);
  });

  it('opens an index when session-index is enabled', () => {
    const config = {
      sessions: { index: { path: join(tmp, 'index.sqlite') } },
    } as unknown as SdConfig;
    const result = resolveSessionIndexForWorker('session-index', config);
    assert.equal(result.disabled, false);
    assert.ok(result.disabled === false && result.index, 'expected an open SdSessionIndex');
    // SdSessionIndex exposes a path getter; sanity-check it points at our temp file.
    const idx = result.disabled === false ? result.index : undefined;
    assert.equal(idx?.path, join(tmp, 'index.sqlite'));
    idx?.close?.();
  });
});
