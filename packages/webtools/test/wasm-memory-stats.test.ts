import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getWebtoolsWasmMemoryStats, registerWebtoolsCore } from '../src/wasm-diagnostics.js';
import type { WebtoolsCore, WebtoolsDiagnostics } from '../src/wasm-types.js';

test('reading wasm memory stats does not instantiate the bundled module', () => {
  assert.deepEqual(getWebtoolsWasmMemoryStats(), {
    activeCores: 0,
    memoryPages: 0,
    maxCoreMemoryPages: 0,
    registryEntries: 0,
    droppedRegistrations: 0,
  });
});

test('wasm memory stats registry is bounded and reports dropped registrations', () => {
  const cores = Array.from({ length: 257 }, fakeCore);
  const releases = cores.map(registerWebtoolsCore);
  assert.deepEqual(getWebtoolsWasmMemoryStats(), {
    activeCores: 256,
    memoryPages: 256,
    maxCoreMemoryPages: 2,
    registryEntries: 256,
    droppedRegistrations: 1,
  });

  for (const release of releases) release();
  assert.deepEqual(getWebtoolsWasmMemoryStats(), {
    activeCores: 0,
    memoryPages: 0,
    maxCoreMemoryPages: 0,
    registryEntries: 0,
    droppedRegistrations: 1,
  });
});

function fakeCore(): WebtoolsCore {
  return {
    call<T>(): T {
      throw new Error('not used');
    },
    diagnostics(): Readonly<WebtoolsDiagnostics> {
      return {
        calls: 0,
        successes: 0,
        requestEncodingFailures: 0,
        requestBudgetFailures: 0,
        responseBudgetFailures: 0,
        allocationFailures: 0,
        trapFailures: 0,
        corruptResponseFailures: 0,
        reinstantiations: 0,
        reinstantiationFailures: 0,
        memoryPages: 1,
        maxMemoryPages: 2,
      };
    },
    dispose() {},
  };
}
