import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  collectTasks,
  datasetTaskSource,
  evaluateSource,
  httpTaskSource,
  isBoundedSource,
  type LearningDataset,
  mixedTaskSource,
  proceduralTaskSource,
  processTaskSource,
  type TaskExample,
} from '../src/index.js';

const dataset: LearningDataset = {
  id: 'tiny',
  examples: [
    { id: 'a', prompt: 'one' },
    { id: 'b', prompt: 'two' },
    { id: 'c', prompt: 'three' },
    { id: 'd', prompt: 'four' },
  ],
};

test('datasetTaskSource yields stable indexed access and respects count', async () => {
  const src = datasetTaskSource(dataset);
  assert.equal(src.kind, 'dataset');
  assert.equal(src.size, 4);
  assert.equal(isBoundedSource(src), true);
  assert.equal((await src.at!(2)).id, 'c');
  const tasks = await collectTasks(src, 3);
  assert.deepEqual(
    tasks.map((t) => t.id),
    ['a', 'b', 'c'],
  );
});

test('datasetTaskSource with shuffle is deterministic per seed', async () => {
  const src = datasetTaskSource(dataset, { shuffle: true });
  const a = await collectTasks(src, 4, 42);
  const b = await collectTasks(src, 4, 42);
  const c = await collectTasks(src, 4, 99);
  assert.deepEqual(
    a.map((t) => t.id),
    b.map((t) => t.id),
  );
  assert.notDeepEqual(
    a.map((t) => t.id),
    c.map((t) => t.id),
  );
});

test('proceduralTaskSource generates from (seed, index)', async () => {
  const src = proceduralTaskSource({
    id: 'proc-math',
    generate: ({ seed, index }) => ({
      id: `t-${seed}-${index}`,
      prompt: `compute ${seed + index}`,
    }),
  });
  assert.equal(src.kind, 'procedural');
  assert.equal(src.size, undefined);
  const tasks = await collectTasks(src, 3, 7);
  assert.deepEqual(
    tasks.map((t) => t.id),
    ['t-7-0', 't-7-1', 't-7-2'],
  );
});

test('mixedTaskSource allocates by weight and aggregates bounded size', async () => {
  const small = datasetTaskSource({ id: 's', examples: dataset.examples.slice(0, 2) });
  const proc = proceduralTaskSource({
    id: 'p',
    size: 10,
    generate: ({ index }) => ({ id: `p-${index}`, prompt: 'syn' }),
  });
  const mix = mixedTaskSource({
    id: 'mix',
    sources: [
      { source: small, weight: 1 },
      { source: proc, weight: 3 },
    ],
  });
  assert.equal(mix.size, 12);
  const tasks = await collectTasks(mix, 8, 1);
  // 1/4 from small (=2, capped at small.size=2), 3/4 from proc (=6).
  const smallCount = tasks.filter((t) => t.id.startsWith('p-')).length;
  assert.equal(smallCount, 6);
});

test('mixedTaskSource rejects empty source list and non-positive weights', () => {
  assert.throws(() => mixedTaskSource({ id: 'x', sources: [] }));
  const proc = proceduralTaskSource({ id: 'p', generate: () => ({ id: 'q', prompt: '' }) });
  assert.throws(() => mixedTaskSource({ id: 'x', sources: [{ source: proc, weight: 0 }] }));
});

test('httpTaskSource POSTs request and parses response', async () => {
  let captured: { url: string; body: unknown } | undefined;
  const fakeFetch: typeof fetch = (async (url: string, init?: RequestInit) => {
    captured = { url, body: JSON.parse(String(init?.body ?? '{}')) };
    const tasks: TaskExample[] = [
      { id: 'h1', prompt: 'task one' },
      { id: 'h2', prompt: 'task two' },
    ];
    return new Response(JSON.stringify({ tasks }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const src = httpTaskSource({
    id: 'gym',
    url: 'https://example.test/sample',
    fetch: fakeFetch,
    headers: () => ({ authorization: 'Bearer abc' }),
  });

  const tasks = await collectTasks(src, 2, 5);
  assert.equal(captured?.url, 'https://example.test/sample');
  assert.equal((captured?.body as { sourceId: string }).sourceId, 'gym');
  assert.equal((captured?.body as { count: number }).count, 2);
  assert.equal((captured?.body as { seed: number }).seed, 5);
  // requestId is deterministic when seed is supplied.
  assert.equal((captured?.body as { requestId: string }).requestId, 'gym-5-2');
  assert.deepEqual(
    tasks.map((t) => t.id),
    ['h1', 'h2'],
  );
});

test('httpTaskSource throws on non-2xx', async () => {
  const fakeFetch: typeof fetch = (async () =>
    new Response('nope', { status: 500, statusText: 'Server Error' })) as unknown as typeof fetch;
  const src = httpTaskSource({ id: 'g', url: 'http://x', fetch: fakeFetch });
  await assert.rejects(() => collectTasks(src, 1));
});

test('processTaskSource spawns child and reads NDJSON tasks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-source-'));
  const scriptPath = join(dir, 'gen.mjs');
  await writeFile(
    scriptPath,
    `import { stdin, stdout } from 'node:process';
let buf = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => { buf += chunk; });
stdin.on('end', () => {
  const req = JSON.parse(buf);
  for (let i = 0; i < req.count; i++) {
    stdout.write(JSON.stringify({ id: 'p' + i, prompt: 'live ' + i }) + '\\n');
  }
});
`,
  );
  const src = processTaskSource({
    id: 'live',
    command: process.execPath,
    args: [scriptPath],
    timeoutMs: 5_000,
  });
  const tasks = await collectTasks(src, 3);
  assert.deepEqual(
    tasks.map((t) => t.id),
    ['p0', 'p1', 'p2'],
  );
});

test('evaluateSource works with a streaming procedural source via options.count', async () => {
  const src = proceduralTaskSource({
    id: 'stream',
    generate: ({ index }) => ({ id: `s${index}`, prompt: 'go' }),
  });
  const result = await evaluateSource(
    { id: 'job-1', kind: 'eval', dataset: 'stream' },
    src,
    {
      id: 'r1',
      evaluate: async () => ({
        score: 1,
        signals: [{ id: 'ok', kind: 'programmatic', weight: 1, score: 1 }],
      }),
    },
    async (ex) => ({ exampleId: ex.id, output: 'done', toolCalls: [] }),
    { count: 4 },
  );
  assert.equal(result.examples, 4);
  assert.equal(result.score, 1);
});

test('evaluateSource throws when streaming source given without count', async () => {
  const src = proceduralTaskSource({
    id: 'stream-2',
    generate: () => ({ id: 'x', prompt: '' }),
  });
  await assert.rejects(() =>
    evaluateSource(
      { id: 'job-2', kind: 'eval', dataset: 'stream-2' },
      src,
      { id: 'r2', evaluate: async () => ({ score: 0, signals: [] }) },
      async (ex) => ({ exampleId: ex.id, output: '', toolCalls: [] }),
    ),
  );
});

test('mixedTaskSource backfills when a weighted source under-delivers', async () => {
  // Bounded source with only 1 task; other source is procedural (unbounded).
  const tiny = datasetTaskSource({
    id: 'tiny-1',
    examples: [{ id: 'only', prompt: 'x' }],
  });
  const proc = proceduralTaskSource({
    id: 'fill',
    generate: ({ index }) => ({ id: `f-${index}`, prompt: '' }),
  });
  const mix = mixedTaskSource({
    id: 'mix-fill',
    sources: [
      { source: tiny, weight: 1 },
      { source: proc, weight: 1 },
    ],
  });
  const tasks = await collectTasks(mix, 6);
  assert.equal(tasks.length, 6);
  // Exhausted source contributes at most its size.
  assert.ok(tasks.filter((t) => t.id === 'only').length <= 1);
});

test('processTaskSource aborts mid-stream on AbortSignal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-source-abort-'));
  const script = join(dir, 'slow.mjs');
  // Child emits one task then sleeps; abort should cut us off cleanly.
  await writeFile(
    script,
    [
      'process.stdout.write(JSON.stringify({ id: "p1", prompt: "first" }) + "\\n");',
      'await new Promise((r) => setTimeout(r, 5000));',
      'process.stdout.write(JSON.stringify({ id: "p2", prompt: "second" }) + "\\n");',
    ].join('\n'),
  );
  const src = processTaskSource({
    id: 'slow',
    command: process.execPath,
    args: [script],
    timeoutMs: 10_000,
  });
  const controller = new AbortController();
  const start = Date.now();
  const out: TaskExample[] = [];
  for await (const task of src.sample({ count: 5, signal: controller.signal })) {
    out.push(task);
    controller.abort();
  }
  const elapsed = Date.now() - start;
  assert.equal(out.length, 1);
  assert.ok(elapsed < 2000, `abort should be prompt, took ${elapsed}ms`);
});
