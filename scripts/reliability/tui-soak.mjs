import assert from 'node:assert/strict';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createTuiFixture, streamFrame } from './tui-fixture.mjs';

const duration = Number(process.env.SD_SOAK_SECONDS ?? 0) * 1000;
const frameTarget = Number(process.env.SD_SOAK_FRAMES ?? 10_000);
const report = resolve(process.env.SD_SOAK_REPORT ?? '.quality/reliability/tui-soak.jsonl');
assert(global.gc, 'Run with --expose-gc --max-old-space-size=512');
assert(Number.isFinite(duration) && duration >= 0);
assert(Number.isSafeInteger(frameTarget) && frameTarget >= 100);
await mkdir(dirname(report), { recursive: true });
const started = Date.now();
const fixture = await createTuiFixture();
let frame = 0;
let warmHeap;
let peakGrowth = 0;
let reloads = 0;
async function sample(phase) {
  global.gc();
  await delay(0);
  global.gc();
  const memory = process.memoryUsage();
  if (frame >= 4000 && warmHeap === undefined) warmHeap = memory.heapUsed;
  if (warmHeap !== undefined) peakGrowth = Math.max(peakGrowth, memory.heapUsed - warmHeap);
  const entry = {
    phase,
    frame,
    elapsedMs: Date.now() - started,
    ...memory,
    peakGrowth,
    reloads,
    resources: process.getActiveResourcesInfo(),
    inputListeners: fixture.input
      .eventNames()
      .map((name) => [String(name), fixture.input.listenerCount(name)]),
    wasmPages: null, // No webtools calls in this foreground-only fixture.
    performanceEntries: performance.getEntries().length,
  };
  await appendFile(report, `${JSON.stringify(entry)}\n`);
  process.stdout.write(
    `${phase}: ${frame} frames, heap ${(memory.heapUsed / 1048576).toFixed(1)} MiB, RSS ${(memory.rss / 1048576).toFixed(1)} MiB\n`,
  );
}
try {
  await sample('start');
  while (duration ? Date.now() - started < duration : frame < frameTarget) {
    streamFrame(fixture, frame);
    await fixture.flush();
    frame += 1;
    if (frame % 1000 === 0) {
      await fixture.reload(reloads % 2 === 0);
      reloads += 1;
      await fixture.flush();
      await sample('running');
    }
    if (duration) await delay(50);
  }
  await sample('complete');
  assert(peakGrowth <= 32 * 1048576, `Retained heap grew ${peakGrowth} bytes after warm-up`);
} finally {
  await fixture.dispose();
  await delay(100);
  await sample('disposed');
}
assert.equal(fixture.input.listenerCount('data'), 0, 'input adapter leaked data listener');
assert.equal(fixture.output.listenerCount('resize'), 0, 'renderer leaked resize listener');
assert.equal(
  process.listenerCount('SIGINT'),
  fixture.initialSigintListeners,
  'renderer leaked SIGINT listener',
);
assert.deepEqual(
  Object.fromEntries(
    process.eventNames().map((name) => [String(name), process.listenerCount(name)]),
  ),
  fixture.initialProcessListeners,
  'mount/resume/reload leaked process listeners',
);
process.stdout.write(`PASS: ${frame} real TUI frames, ${reloads} resume/reload mount cycles\n`);
