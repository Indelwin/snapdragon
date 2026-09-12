import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { WebtoolsResourceLimitError } from '../src/resource-limits.js';
import { getWebtoolsWasmMemoryStats, loadWebtools } from '../src/wasm.js';
import { webtoolsArtifactUrl } from '../src/wasm-artifact.js';
import { callWasmExport, MAX_ABI_REQUEST_BYTES, MAX_ABI_RESPONSE_BYTES } from '../src/wasm-call.js';
import { instantiateWebtools, instantiateWebtoolsModule } from '../src/wasm-instantiate.js';
import type { WebtoolsExports } from '../src/wasm-types.js';
import { WebtoolsWasmRuntimeError } from '../src/wasm-types.js';

const ENCODER = new TextEncoder();

test('real wasm round-trips and exposes payload-free numeric diagnostics', async () => {
  const statsBefore = getWebtoolsWasmMemoryStats();
  const core = await instantiateWebtools(await readFile(webtoolsArtifactUrl));
  const statsDuring = getWebtoolsWasmMemoryStats();
  assert.equal(statsDuring.activeCores, statsBefore.activeCores + 1);
  assert.ok(statsDuring.memoryPages > statsBefore.memoryPages);
  assert.ok(statsDuring.maxCoreMemoryPages > 0);
  const response = core.call<{ ok: true; value: string }>('url_util', {
    op: 'normalize',
    args: { raw: 'example.com/path/' },
  });

  assert.deepEqual(response, { ok: true, value: 'https://example.com/path' });
  assert.deepEqual(core.diagnostics(), {
    calls: 1,
    successes: 1,
    requestEncodingFailures: 0,
    requestBudgetFailures: 0,
    responseBudgetFailures: 0,
    allocationFailures: 0,
    trapFailures: 0,
    corruptResponseFailures: 0,
    reinstantiations: 0,
    reinstantiationFailures: 0,
    memoryPages: core.diagnostics().memoryPages,
    maxMemoryPages: core.diagnostics().maxMemoryPages,
  });
  assert.ok(core.diagnostics().memoryPages > 0);
  assert.ok(Object.values(core.diagnostics()).every((value) => typeof value === 'number'));

  core.dispose();
  assert.equal(core.diagnostics().memoryPages, 0);
  assert.ok(core.diagnostics().maxMemoryPages > 0);
  assert.deepEqual(getWebtoolsWasmMemoryStats(), statsBefore);
  assert.throws(() => core.call('url_util', {}), /disposed/);
});

test('real wasm returns explicit native budget failures', async () => {
  const core = await instantiateWebtools(await readFile(webtoolsArtifactUrl));
  const html = core.call<{ ok: false; error: string }>('extractor', {
    op: 'detect_js_only',
    args: { html: 'x'.repeat(2_000_001) },
  });
  assert.equal(html.ok, false);
  assert.match(html.error, /HTML input bytes budget exceeded/);

  const candidates = core.call<{ ok: false; error: string }>('content_filter', {
    op: 'chunk',
    args: { markdown: Array.from({ length: 4_097 }, () => 'a').join('\n\n'), min_chars: 1 },
  });
  assert.equal(candidates.ok, false);
  assert.match(candidates.error, /candidate budget exceeded/);
  core.dispose();
});

test('real wasm reuses freed buffers under repeated-call stress', async () => {
  const core = await instantiateWebtools(await readFile(webtoolsArtifactUrl));
  for (let index = 0; index < 100; index += 1) callNormalize(core, index);
  const warmedPages = core.diagnostics().memoryPages;
  for (let index = 100; index < 5_000; index += 1) callNormalize(core, index);

  const diagnostics = core.diagnostics();
  assert.equal(diagnostics.calls, 5_000);
  assert.equal(diagnostics.successes, 5_000);
  assert.equal(diagnostics.reinstantiations, 0);
  assert.ok(diagnostics.memoryPages <= warmedPages + 1);
  core.dispose();
});

test('bundled cores share only the compiled module and dispose independently', async () => {
  const first = await loadWebtools();
  const second = await loadWebtools();
  assert.notEqual(second, first);
  first.dispose();

  assert.deepEqual(second.call('url_util', { op: 'host', args: { url: 'https://example.com' } }), {
    ok: true,
    value: 'example.com',
  });
  second.dispose();
});

test('signed request pointers are normalized and freed when the memory copy fails', () => {
  const deallocations: Array<[number, number]> = [];
  const exports = fakeExports({
    alloc: () => -1,
    call: () => {
      throw new Error('export must not run');
    },
    deallocations,
  });

  assert.throws(
    () => callWasmExport(exports, 'url_util', { enough: 'bytes' }),
    (error) => error instanceof WebtoolsWasmRuntimeError && error.failure === 'trap',
  );
  assert.equal(deallocations.length, 1);
  assert.equal(deallocations[0]?.[0], 0xffff_ffff);
});

test('request allocation is freed when the wasm export traps', () => {
  const deallocations: Array<[number, number]> = [];
  const exports = fakeExports({
    call: () => {
      throw new WebAssembly.RuntimeError('synthetic trap');
    },
    deallocations,
  });

  assert.throws(
    () => callWasmExport(exports, 'url_util', { op: 'normalize' }),
    (error) => error instanceof WebtoolsWasmRuntimeError && error.failure === 'trap',
  );
  assert.equal(deallocations.length, 1);
});

test('a trapped input free abandons the output with the disposable instance', () => {
  const deallocations: Array<[number, number]> = [];
  const request = { op: 'normalize' };
  const exports = fakeExports({
    call: (_ptr, _len, memory) => writeResponse(memory, 4_096, '{"ok":true,"value":null}'),
    deallocate: (ptr, len) => {
      deallocations.push([ptr, len]);
      throw new WebAssembly.RuntimeError('synthetic input deallocation trap');
    },
  });

  assert.throws(
    () => callWasmExport(exports, 'url_util', request),
    (error) => error instanceof WebtoolsWasmRuntimeError && error.failure === 'trap',
  );
  assert.deepEqual(deallocations, [[1_024, ENCODER.encode(JSON.stringify(request)).byteLength]]);
});

test('response allocation is freed when JSON or envelope validation fails', () => {
  for (const response of ['not json', '{"unexpected":true}']) {
    const deallocations: Array<[number, number]> = [];
    const exports = fakeExports({
      call: (_ptr, _len, memory) => writeResponse(memory, 4_096, response),
      deallocations,
    });

    assert.throws(
      () => callWasmExport(exports, 'url_util', { op: 'normalize' }),
      (error) => error instanceof WebtoolsWasmRuntimeError && error.failure === 'corrupt_response',
    );
    assert.equal(deallocations.length, 2);
    assert.deepEqual(deallocations[1], [4_096, ENCODER.encode(response).byteLength]);
  }
});

test('ABI request and response byte budgets fail explicitly and still clean up', () => {
  let allocations = 0;
  const oversizedRequestExports = fakeExports({
    alloc: () => {
      allocations += 1;
      return 1_024;
    },
  });
  assert.throws(
    () =>
      callWasmExport(oversizedRequestExports, 'url_util', {
        value: 'x'.repeat(MAX_ABI_REQUEST_BYTES),
      }),
    (error) =>
      error instanceof WebtoolsResourceLimitError && error.resource === 'WASM ABI request bytes',
  );
  assert.equal(allocations, 0);

  const deallocations: Array<[number, number]> = [];
  const oversizedResponseExports = fakeExports({
    call: () => pack(4_096, MAX_ABI_RESPONSE_BYTES + 1),
    deallocations,
    memoryPages: 257,
  });
  assert.throws(
    () => callWasmExport(oversizedResponseExports, 'url_util', { op: 'normalize' }),
    (error) =>
      error instanceof WebtoolsResourceLimitError && error.resource === 'WASM ABI response bytes',
  );
  assert.deepEqual(deallocations[1], [4_096, MAX_ABI_RESPONSE_BYTES + 1]);
});

test('owned runtime reinstantiates after allocation, trap, and corrupt response failures', async () => {
  const cases = [
    { module: failureModule('allocation'), count: 'allocationFailures' },
    { module: failureModule('trap'), count: 'trapFailures' },
    { module: failureModule('dealloc_trap'), count: 'trapFailures' },
    { module: failureModule('corrupt_response'), count: 'corruptResponseFailures' },
  ] as const;

  for (const fixture of cases) {
    const source = fixture.module;
    const core = await instantiateWebtools(source);
    source.fill(0);

    assert.throws(() => core.call('url_util', { op: 'normalize' }));
    assert.equal(core.diagnostics()[fixture.count], 1);
    assert.equal(core.diagnostics().reinstantiations, 1);
    assert.equal(core.diagnostics().memoryPages, 1);

    assert.throws(() => core.call('url_util', { op: 'normalize' }));
    assert.equal(core.diagnostics()[fixture.count], 2);
    assert.equal(core.diagnostics().reinstantiations, 2);
    core.dispose();
  }
});

test('memory high-water survives failure replacement and disposal', async () => {
  const core = await instantiateWebtools(failureModule('grow_then_trap'));

  assert.throws(() => core.call('url_util', { op: 'normalize' }));
  assert.equal(core.diagnostics().memoryPages, 1);
  assert.equal(core.diagnostics().maxMemoryPages, 4);
  core.dispose();
  assert.equal(core.diagnostics().memoryPages, 0);
  assert.equal(core.diagnostics().maxMemoryPages, 4);
});

test('failed recovery construction preserves the original typed call failure', async () => {
  const module = await WebAssembly.compile(failureModule('trap'));
  const descriptor = Object.getOwnPropertyDescriptor(WebAssembly, 'Instance');
  if (!descriptor) throw new Error('WebAssembly.Instance descriptor unavailable');
  let constructions = 0;
  const replacement = new Proxy(WebAssembly.Instance, {
    construct(target, args) {
      constructions += 1;
      if (constructions === 2) throw new Error('synthetic recovery construction failure');
      return Reflect.construct(target, args);
    },
  });
  Object.defineProperty(WebAssembly, 'Instance', { ...descriptor, value: replacement });
  try {
    const core = instantiateWebtoolsModule(module);
    assert.throws(
      () => core.call('url_util', { op: 'normalize' }),
      (error) =>
        error instanceof WebtoolsWasmRuntimeError &&
        error.failure === 'trap' &&
        error.cause instanceof WebAssembly.RuntimeError,
    );
    assert.equal(core.diagnostics().reinstantiationFailures, 1);
    assert.equal(core.diagnostics().memoryPages, 0);
    core.dispose();
  } finally {
    Object.defineProperty(WebAssembly, 'Instance', descriptor);
  }
});

test('response budget failures also replace the disposable instance', async () => {
  const core = await instantiateWebtools(failureModule('response_budget'));

  assert.throws(
    () => core.call('url_util', { op: 'normalize' }),
    (error) => error instanceof WebtoolsResourceLimitError,
  );
  assert.equal(core.diagnostics().responseBudgetFailures, 1);
  assert.equal(core.diagnostics().reinstantiations, 1);
  core.dispose();
});

interface FakeOptions {
  alloc?: (size: number, memory: WebAssembly.Memory) => number;
  call?: (ptr: number, len: number, memory: WebAssembly.Memory) => bigint;
  deallocations?: Array<[number, number]>;
  deallocate?: (ptr: number, len: number) => void;
  memoryPages?: number;
}

function fakeExports(options: FakeOptions = {}): WebtoolsExports {
  const memory = new WebAssembly.Memory({ initial: options.memoryPages ?? 1 });
  const call = (ptr: number, len: number) =>
    options.call?.(ptr, len, memory) ?? writeResponse(memory, 4_096, '{"ok":true,"value":null}');
  return {
    memory,
    wt_alloc: (size) => options.alloc?.(size, memory) ?? 1_024,
    wt_dealloc: (ptr, len) => {
      if (options.deallocate) options.deallocate(ptr, len);
      else options.deallocations?.push([ptr, len]);
    },
    wt_url_util: call,
    wt_robots: call,
    wt_content_filter: call,
    wt_extractor: call,
  };
}

function writeResponse(memory: WebAssembly.Memory, ptr: number, response: string): bigint {
  const bytes = ENCODER.encode(response);
  new Uint8Array(memory.buffer, ptr, bytes.byteLength).set(bytes);
  return pack(ptr, bytes.byteLength);
}

function pack(ptr: number, len: number): bigint {
  return (BigInt(ptr) << 32n) | BigInt(len);
}

function callNormalize(core: Awaited<ReturnType<typeof instantiateWebtools>>, index: number): void {
  const result = core.call<{ ok: true; value: string }>('url_util', {
    op: 'normalize',
    args: { raw: `https://example.com/path/${index}?utm_source=stress` },
  });
  assert.equal(result.ok, true);
}

type FailureFixture =
  | 'allocation'
  | 'trap'
  | 'dealloc_trap'
  | 'grow_then_trap'
  | 'corrupt_response'
  | 'response_budget';

function failureModule(fixture: FailureFixture): Uint8Array<ArrayBuffer> {
  const typeSection = section(
    1,
    vector([
      [0x60, ...vector([[0x7f]]), ...vector([[0x7f]])],
      [0x60, ...vector([[0x7f], [0x7f]]), ...vector([])],
      [0x60, ...vector([[0x7f], [0x7f]]), ...vector([[0x7e]])],
    ]),
  );
  const functionSection = section(3, [
    ...unsigned(3),
    ...unsigned(0),
    ...unsigned(1),
    ...unsigned(2),
  ]);
  const memorySection = section(5, [...unsigned(1), 0x00, ...unsigned(1)]);
  const exportSection = section(
    7,
    exportEntries([
      ['memory', 0x02, 0],
      ['wt_alloc', 0x00, 0],
      ['wt_dealloc', 0x00, 1],
      ['wt_url_util', 0x00, 2],
      ['wt_robots', 0x00, 2],
      ['wt_content_filter', 0x00, 2],
      ['wt_extractor', 0x00, 2],
    ]),
  );
  const allocPointer = fixture === 'allocation' ? 0 : 1_024;
  const allocBody = body([0x41, ...signed(BigInt(allocPointer)), 0x0b]);
  const deallocBody = fixture === 'dealloc_trap' ? body([0x00, 0x0b]) : body([0x0b]);
  const operationBody = operationFixtureBody(fixture);
  const codeSection = section(10, [...unsigned(3), ...allocBody, ...deallocBody, ...operationBody]);
  return Uint8Array.from([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...typeSection,
    ...functionSection,
    ...memorySection,
    ...exportSection,
    ...codeSection,
  ]);
}

function operationFixtureBody(fixture: FailureFixture): number[] {
  if (fixture === 'trap') return body([0x00, 0x0b]);
  if (fixture === 'grow_then_trap') {
    return body([0x41, ...signed(3n), 0x40, 0x00, 0x1a, 0x00, 0x0b]);
  }
  return body([0x42, ...signed(fixtureResult(fixture)), 0x0b]);
}

function fixtureResult(fixture: FailureFixture): bigint {
  if (fixture === 'response_budget') return pack(8, MAX_ABI_RESPONSE_BYTES + 1);
  return pack(8, 1);
}

function exportEntries(entries: ReadonlyArray<readonly [string, number, number]>): number[] {
  return [
    ...unsigned(entries.length),
    ...entries.flatMap(([name, kind, index]) => [...encodedName(name), kind, ...unsigned(index)]),
  ];
}

function section(id: number, payload: number[]): number[] {
  return [id, ...unsigned(payload.length), ...payload];
}

function vector(items: number[][]): number[] {
  return [...unsigned(items.length), ...items.flat()];
}

function body(instructions: number[]): number[] {
  const payload = [0x00, ...instructions];
  return [...unsigned(payload.length), ...payload];
}

function encodedName(value: string): number[] {
  const bytes = [...ENCODER.encode(value)];
  return [...unsigned(bytes.length), ...bytes];
}

function unsigned(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function signed(input: bigint): number[] {
  const bytes: number[] = [];
  let value = input;
  while (true) {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    const done = (value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0);
    if (!done) byte |= 0x80;
    bytes.push(byte);
    if (done) return bytes;
  }
}
