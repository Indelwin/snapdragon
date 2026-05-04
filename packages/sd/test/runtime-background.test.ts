import assert from 'node:assert/strict';
import test from 'node:test';
import type { SdSessionIndex } from '@snapdragon-ai/session';
import type { SdBackgroundRebindParts, SdBackgroundServicesHandle } from '../src/background.ts';
import { defaultSdConfig } from '../src/config.ts';
import type { SdMemoryProvider } from '../src/memory.ts';
import type { SdProviderRuntime } from '../src/provider.ts';
import {
  type ReplaceRuntimeBackgroundCurrent,
  type RuntimeBackgroundParts,
  replaceRuntimeBackground,
} from '../src/runtime-background.ts';
import type { SdRuntimeOptions } from '../src/runtime-options.ts';
import type { SdSkillStore } from '../src/skills.ts';

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

const stubSkills = {} as unknown as SdSkillStore;

function stubProvider(): SdProviderRuntime {
  return {
    handler: async () => ({ content: '' }),
  } as unknown as SdProviderRuntime;
}

function stubSessionIndex(label: string): SdSessionIndex {
  return { label, close: () => undefined } as unknown as SdSessionIndex;
}

interface FakeHandle extends SdBackgroundServicesHandle {
  rebindCalls: SdBackgroundRebindParts[];
  stopCalls: number;
}

function fakeHandle(): FakeHandle {
  const handle = {
    rebindCalls: [] as SdBackgroundRebindParts[],
    stopCalls: 0,
    rebindStores(parts: SdBackgroundRebindParts) {
      this.rebindCalls.push(parts);
    },
    stop() {
      this.stopCalls += 1;
    },
    flush: async () => {},
    runNow: async () => undefined,
    list: () => [],
    status: () => undefined,
  };
  return handle as unknown as FakeHandle;
}

function makeCurrent(
  overrides: Partial<ReplaceRuntimeBackgroundCurrent> & {
    background: SdBackgroundServicesHandle;
  },
): ReplaceRuntimeBackgroundCurrent {
  return {
    options: {} as SdRuntimeOptions,
    sessionIndex: undefined,
    ...overrides,
  };
}

function makeParts(overrides: Partial<RuntimeBackgroundParts> = {}): RuntimeBackgroundParts {
  return {
    config: defaultSdConfig(),
    provider: stubProvider(),
    skills: stubSkills,
    memory: stubMemory,
    ...overrides,
  };
}

test('replaceRuntimeBackground rebinds in place when sessionIndex ref is unchanged', () => {
  const handle = fakeHandle();
  const sessionIndex = stubSessionIndex('shared');
  const current = makeCurrent({ background: handle, sessionIndex });
  const parts = makeParts({ sessionIndex });

  const result = replaceRuntimeBackground(current, parts);

  assert.strictEqual(result, handle, 'returns the same gateway handle');
  assert.equal(handle.stopCalls, 0, 'must not stop the gateway on the hot path');
  assert.equal(handle.rebindCalls.length, 1);
  const rebound = handle.rebindCalls[0];
  assert.strictEqual(rebound.memory, parts.memory);
  assert.strictEqual(rebound.skills, parts.skills);
  assert.equal(typeof rebound.chat, 'function', 'wires a fresh background-chat closure');
});

test('replaceRuntimeBackground stops & closes the old session index when it changes', () => {
  const handle = fakeHandle();
  let oldClosed = 0;
  const oldIndex = {
    close: () => {
      oldClosed += 1;
    },
  } as unknown as SdSessionIndex;
  const current = makeCurrent({ background: handle, sessionIndex: oldIndex });
  const newIndex = stubSessionIndex('new');
  const parts = makeParts({ sessionIndex: newIndex });

  const result = replaceRuntimeBackground(current, parts);

  assert.equal(handle.stopCalls, 1, 'old gateway is torn down');
  assert.equal(handle.rebindCalls.length, 0, 'rebind path is NOT taken on shape change');
  assert.equal(oldClosed, 1, 'orphaned session index is closed');
  assert.notStrictEqual(result, handle, 'returns a fresh gateway handle');
  result.stop();
});

test('replaceRuntimeBackground attaches a session index when one was previously absent', () => {
  // Going from "no index" to "has index" is a shape change: must restart, not rebind.
  const handle = fakeHandle();
  const current = makeCurrent({ background: handle, sessionIndex: undefined });
  const newIndex = stubSessionIndex('attached');
  const parts = makeParts({ sessionIndex: newIndex });

  const result = replaceRuntimeBackground(current, parts);

  assert.equal(handle.stopCalls, 1);
  assert.equal(handle.rebindCalls.length, 0);
  assert.notStrictEqual(result, handle);
  result.stop();
});

test('replaceRuntimeBackground detaches a session index when one is no longer wanted', () => {
  // Going from "has index" to "no index" is also a shape change. The old
  // index ref must be closed since the runtime no longer carries it.
  const handle = fakeHandle();
  let closed = 0;
  const oldIndex = {
    close: () => {
      closed += 1;
    },
  } as unknown as SdSessionIndex;
  const current = makeCurrent({ background: handle, sessionIndex: oldIndex });
  const parts = makeParts({ sessionIndex: undefined });

  const result = replaceRuntimeBackground(current, parts);

  assert.equal(handle.stopCalls, 1);
  assert.equal(closed, 1, 'detached session index is closed');
  result.stop();
});
