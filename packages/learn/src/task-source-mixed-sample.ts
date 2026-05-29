import type { TaskExample } from './dataset.js';
import type { TaskSourceSampleArgs } from './task-source.js';
import { allocateMixedCounts } from './task-source-mixed-plan.js';
import type { MixedSourceWeight } from './task-source-mixed-types.js';

interface MixedSampleState {
  delivered: number[];
  totalDelivered: number;
}

export async function* sampleMixedTasks(
  sources: readonly MixedSourceWeight[],
  totalWeight: number,
  args: TaskSourceSampleArgs,
): AsyncGenerator<TaskExample> {
  const counts = allocateMixedCounts(sources, totalWeight, args.count);
  const state = { delivered: new Array<number>(sources.length).fill(0), totalDelivered: 0 };
  yield* sampleAllocated(sources, counts, args, state);
  yield* refillDeficit(sources, args, state);
}

async function* sampleAllocated(
  sources: readonly MixedSourceWeight[],
  counts: readonly number[],
  args: TaskSourceSampleArgs,
  state: MixedSampleState,
): AsyncGenerator<TaskExample> {
  for (const [index, slot] of sources.entries()) {
    const allotted = counts[index] ?? 0;
    if (allotted <= 0) continue;
    const emitted = yield* sampleSlot(slot, allotted, subSeed(args.seed, index), args.signal);
    recordDelivered(state, index, emitted);
  }
}

async function* refillDeficit(
  sources: readonly MixedSourceWeight[],
  args: TaskSourceSampleArgs,
  state: MixedSampleState,
): AsyncGenerator<TaskExample> {
  let deficit = args.count - state.totalDelivered;
  for (let guard = 1; deficit > 0 && guard <= sources.length * 2; guard += 1) {
    const emitted = yield* refillRound(sources, args, state, deficit, guard);
    if (emitted === 0) break;
    deficit -= emitted;
  }
}

async function* refillRound(
  sources: readonly MixedSourceWeight[],
  args: TaskSourceSampleArgs,
  state: MixedSampleState,
  deficit: number,
  guard: number,
): AsyncGenerator<TaskExample, number> {
  let total = 0;
  for (const [index, slot] of sources.entries()) {
    if (deficit <= total) break;
    if (sourceExhausted(slot, state.delivered[index] ?? 0)) continue;
    const emitted = yield* sampleSlot(
      slot,
      deficit - total,
      subSeed(args.seed, index + guard),
      args.signal,
    );
    recordDelivered(state, index, emitted);
    total += emitted;
  }
  return total;
}

async function* sampleSlot(
  slot: MixedSourceWeight,
  count: number,
  seed: number | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<TaskExample, number> {
  let emitted = 0;
  for await (const task of slot.source.sample({ count, seed, signal })) {
    if (signal?.aborted) return emitted;
    yield task;
    emitted += 1;
    if (emitted >= count) break;
  }
  return emitted;
}

function recordDelivered(state: MixedSampleState, index: number, count: number): void {
  state.delivered[index] = (state.delivered[index] ?? 0) + count;
  state.totalDelivered += count;
}

function sourceExhausted(slot: MixedSourceWeight, delivered: number): boolean {
  return slot.source.size !== undefined && delivered >= slot.source.size;
}

function subSeed(seed: number | undefined, offset: number): number | undefined {
  return seed === undefined ? undefined : (seed + offset * 2654435761) >>> 0;
}
