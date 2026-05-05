import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type SdBackgroundContext,
  type SdBackgroundService,
  startSdBackgroundServices,
} from '../src/background.ts';
import { defaultSdConfig, type SdConfig } from '../src/config.ts';
import type { SdMemoryProvider } from '../src/memory.ts';

const stubMemory: SdMemoryProvider = {
  describe() {
    return { id: 'stub', kind: 'memory' };
  },
  async append() {
    return { success: true };
  },
  async read() {
    return { entries: [] };
  },
};

function makeConfig(overrides: Partial<SdConfig['memory']> = {}): SdConfig {
  return {
    ...defaultSdConfig(),
    memory: { ...defaultSdConfig().memory, ...overrides },
  };
}

interface RecordedRun {
  count: number;
}

function recordingService(
  name: string,
  options: {
    enabled?: boolean;
    intervalMs?: number;
    throwOnce?: boolean;
    summary?: string;
  } = {},
): { service: SdBackgroundService; runs: RecordedRun } {
  const runs: RecordedRun = { count: 0 };
  let pendingThrow = options.throwOnce ?? false;
  return {
    runs,
    service: {
      name,
      enabled: () => options.enabled !== false,
      intervalMs: () => options.intervalMs,
      async runOnce(_ctx: SdBackgroundContext) {
        runs.count += 1;
        if (pendingThrow) {
          pendingThrow = false;
          throw new Error('boom');
        }
        return {
          summary: options.summary ?? `${name} run ${runs.count}`,
          metrics: { ticks: 1 },
        };
      },
    },
  };
}

test('gateway runs an enabled service once after startup', async () => {
  const { service, runs } = recordingService('alpha');
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: stubMemory,
  });
  try {
    await handle.flush();
    assert.equal(runs.count, 1, 'service should have ticked once on startup');
    const status = handle.status('alpha');
    assert.ok(status, 'status should exist');
    assert.equal(status?.runs, 1);
    assert.equal(status?.errors, 0);
    assert.equal(status?.metrics.ticks, 1);
    assert.match(status?.last_summary ?? '', /alpha run 1/);
  } finally {
    handle.stop();
  }
});

test('gateway respects disableAll and per-service disable list', async () => {
  const a = recordingService('alpha');
  const b = recordingService('beta');
  const handleAll = startSdBackgroundServices([a.service, b.service], {
    config: makeConfig(),
    memory: stubMemory,
    disableAll: true,
  });
  try {
    await handleAll.flush();
    assert.equal(a.runs.count, 0);
    assert.equal(b.runs.count, 0);
    const list = handleAll.list();
    assert.deepEqual(list.map((s) => [s.name, s.enabled]).sort(), [
      ['alpha', false],
      ['beta', false],
    ]);
  } finally {
    handleAll.stop();
  }

  const a2 = recordingService('alpha');
  const b2 = recordingService('beta');
  const handlePartial = startSdBackgroundServices([a2.service, b2.service], {
    config: makeConfig(),
    memory: stubMemory,
    disable: ['alpha'],
  });
  try {
    await handlePartial.flush();
    assert.equal(a2.runs.count, 0, 'disabled service must not run');
    assert.equal(b2.runs.count, 1, 'other service still runs');
  } finally {
    handlePartial.stop();
  }
});

test('gateway counts errors and keeps running', async () => {
  const { service, runs } = recordingService('alpha', { throwOnce: true });
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: stubMemory,
  });
  try {
    await handle.flush();
    assert.equal(runs.count, 1, 'first run threw');
    let status = handle.status('alpha');
    assert.equal(status?.errors, 1);
    assert.equal(status?.last_error, 'boom');

    // runNow should succeed on the second invocation
    status = await handle.runNow('alpha');
    assert.equal(runs.count, 2);
    assert.equal(status?.runs, 1, 'one successful run after the failure');
    assert.equal(status?.errors, 1, 'error count is sticky');
  } finally {
    handle.stop();
  }
});

test('gateway runNow on a disabled service is a no-op but reports status', async () => {
  const { service, runs } = recordingService('alpha', { enabled: false });
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: stubMemory,
  });
  try {
    const status = await handle.runNow('alpha');
    assert.equal(runs.count, 0);
    assert.equal(status?.enabled, false);
    assert.equal(status?.runs, 0);
  } finally {
    handle.stop();
  }
});

test('gateway runNow returns undefined for unknown service', async () => {
  const handle = startSdBackgroundServices([], { config: makeConfig(), memory: stubMemory });
  try {
    const status = await handle.runNow('nope');
    assert.equal(status, undefined);
  } finally {
    handle.stop();
  }
});

test('gateway interval reschedules runs and stop halts them', async () => {
  const { service, runs } = recordingService('alpha', { intervalMs: 15 });
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: stubMemory,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 60));
    await handle.flush();
    assert.ok(runs.count >= 2, `expected multiple ticks, got ${runs.count}`);
    handle.stop();
    const snapshot = runs.count;
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(runs.count, snapshot, 'no ticks should fire after stop()');
  } finally {
    handle.stop();
  }
});

test('rebindStores swaps stores seen by the next tick without restarting timers', async () => {
  const seen: SdMemoryProvider[] = [];
  const service: SdBackgroundService = {
    name: 'spy',
    enabled: () => true,
    intervalMs: () => undefined,
    async runOnce(ctx) {
      seen.push(ctx.memory);
      return { summary: 'ok' };
    },
  };
  const memoryA = stubMemory;
  const memoryB: SdMemoryProvider = {
    describe() {
      return { id: 'B', kind: 'memory' };
    },
    async append() {
      return { success: true };
    },
    async read() {
      return { entries: [] };
    },
  };
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: memoryA,
  });
  try {
    await handle.flush();
    assert.equal(seen.length, 1);
    assert.strictEqual(seen[0], memoryA);

    handle.rebindStores({ memory: memoryB });
    await handle.runNow('spy');
    assert.equal(seen.length, 2);
    assert.strictEqual(seen[1], memoryB, 'next tick should observe the rebound memory store');
  } finally {
    handle.stop();
  }
});

test('rebindStores leaves omitted fields untouched and clears explicit undefined', async () => {
  const seenSkills: Array<unknown> = [];
  const seenProfile: Array<unknown> = [];
  const service: SdBackgroundService = {
    name: 'spy',
    enabled: () => true,
    intervalMs: () => undefined,
    async runOnce(ctx) {
      seenSkills.push(ctx.skills);
      seenProfile.push(ctx.profile);
      return undefined;
    },
  };
  const skillsA = { tag: 'A' } as unknown as Parameters<
    typeof startSdBackgroundServices
  >[1]['skills'];
  const profileA = { name: 'p1' } as unknown as Parameters<
    typeof startSdBackgroundServices
  >[1]['profile'];
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: stubMemory,
    skills: skillsA,
    profile: profileA,
  });
  try {
    await handle.flush();
    assert.strictEqual(seenSkills[0], skillsA);
    assert.strictEqual(seenProfile[0], profileA);

    // Rebinding only `memory` must NOT clobber skills / profile.
    handle.rebindStores({ memory: stubMemory });
    await handle.runNow('spy');
    assert.strictEqual(seenSkills[1], skillsA, 'omitted field preserved');
    assert.strictEqual(seenProfile[1], profileA, 'omitted field preserved');

    // Explicit undefined clears the field.
    handle.rebindStores({ profile: undefined });
    await handle.runNow('spy');
    assert.strictEqual(seenProfile[2], undefined, 'explicit undefined clears the field');
    assert.strictEqual(seenSkills[2], skillsA, 'unrelated field still preserved');
  } finally {
    handle.stop();
  }
});

test('rebindStores swaps the chat handle seen by the next tick', async () => {
  const seen: Array<unknown> = [];
  const service: SdBackgroundService = {
    name: 'spy',
    enabled: () => true,
    intervalMs: () => undefined,
    async runOnce(ctx) {
      seen.push(ctx.chat);
      return undefined;
    },
  };
  const chatA = async () => ({ content: 'a' });
  const chatB = async () => ({ content: 'b' });
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: stubMemory,
    chat: chatA,
  });
  try {
    await handle.flush();
    assert.strictEqual(seen[0], chatA);
    handle.rebindStores({ chat: chatB });
    await handle.runNow('spy');
    assert.strictEqual(seen[1], chatB, 'next tick observes the new chat handle');
  } finally {
    handle.stop();
  }
});

test('rebindStores swaps the channel store seen by the next tick', async () => {
  const seen: Array<unknown> = [];
  const service: SdBackgroundService = {
    name: 'spy',
    enabled: () => true,
    intervalMs: () => undefined,
    async runOnce(ctx) {
      seen.push(ctx.channels);
      return undefined;
    },
  };
  const channelsA = { root: 'a' } as unknown as Parameters<
    typeof startSdBackgroundServices
  >[1]['channels'];
  const channelsB = { root: 'b' } as unknown as Parameters<
    typeof startSdBackgroundServices
  >[1]['channels'];
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: stubMemory,
    channels: channelsA,
  });
  try {
    await handle.flush();
    assert.strictEqual(seen[0], channelsA);
    handle.rebindStores({ channels: channelsB });
    await handle.runNow('spy');
    assert.strictEqual(seen[1], channelsB, 'next tick observes the new channel store');
  } finally {
    handle.stop();
  }
});

test('rebindStores during an in-flight tick does not mutate the captured ctx', async () => {
  // Contract: a tick that has already started keeps the values it captured
  // when `runOnce(ctx)` was called. The rebind only affects subsequent ticks.
  let release: (() => void) | undefined;
  const block = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: SdMemoryProvider[] = [];
  const service: SdBackgroundService = {
    name: 'slow',
    enabled: () => true,
    intervalMs: () => undefined,
    async runOnce(ctx) {
      seen.push(ctx.memory);
      await block;
      // After the await, capture again — `ctx` is a frozen view, so the
      // memory ref the service holds onto must still be the original.
      seen.push(ctx.memory);
      return undefined;
    },
  };
  const memoryA = stubMemory;
  const memoryB: SdMemoryProvider = {
    describe() {
      return { id: 'B', kind: 'memory' };
    },
    async append() {
      return { success: true };
    },
    async read() {
      return { entries: [] };
    },
  };
  const handle = startSdBackgroundServices([service], {
    config: makeConfig(),
    memory: memoryA,
  });
  try {
    // First tick is mid-flight (awaiting `block`).
    await Promise.resolve();
    assert.equal(seen.length, 1);
    assert.strictEqual(seen[0], memoryA);

    // Rebind while in flight.
    handle.rebindStores({ memory: memoryB });

    // Let the in-flight tick complete; it must still see memoryA.
    release?.();
    await handle.flush();
    assert.equal(seen.length, 2);
    assert.strictEqual(seen[1], memoryA, 'in-flight tick keeps its captured memory ref');

    // The NEXT tick observes the rebound store.
    await handle.runNow('slow');
    // runNow blocks on `block`, but `block` already resolved — fine.
    assert.strictEqual(seen[2], memoryB, 'subsequent tick observes the rebound store');
  } finally {
    release?.();
    handle.stop();
  }
});

test('gateway rejects duplicate service names', () => {
  const a = recordingService('alpha');
  const b = recordingService('alpha');
  assert.throws(
    () =>
      startSdBackgroundServices([a.service, b.service], {
        config: makeConfig(),
        memory: stubMemory,
      }),
    /duplicate background service name/,
  );
});
