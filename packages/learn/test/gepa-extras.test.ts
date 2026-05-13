import assert from 'node:assert/strict';
import test from 'node:test';

import type { TaskExample } from '../src/dataset.js';
import { optimizeGepa } from '../src/gepa.js';
import type { GepaAdapter, GepaEvaluateResult } from '../src/gepa-adapter.js';
import { gepaFeedbackMemory } from '../src/gepa-memory.js';
import { buildMergeChild, disjointTargets, pickMergePair } from '../src/gepa-merge.js';
import { seededRng } from '../src/gepa-rng.js';
import type { GepaTarget } from '../src/gepa-target.js';
import type { GepaCandidate, GepaReflectiveDatum } from '../src/gepa-types.js';
import { proceduralTaskSource } from '../src/task-source-procedural.js';

function fakeDatum(score: number, id = `task-${score}`): GepaReflectiveDatum {
  return {
    example: { id, input: id } as TaskExample,
    trace: { steps: [], finalOutput: id } as never,
    score,
    rubric: { score, signals: [] },
  };
}

test('feedback memory keeps top-K best and worst per target', () => {
  const memory = gepaFeedbackMemory({ topK: 2, recentLimit: 3 });
  memory.record('prompt', [fakeDatum(0.1, 'a'), fakeDatum(0.9, 'b'), fakeDatum(0.5, 'c')]);
  memory.record('prompt', [fakeDatum(0.95, 'd'), fakeDatum(0.05, 'e')]);

  const summary = memory.summarize('prompt');
  assert.deepEqual(
    summary.best.map((d) => d.example.id),
    ['d', 'b'],
  );
  assert.deepEqual(
    summary.worst.map((d) => d.example.id),
    ['e', 'a'],
  );
  assert.equal(summary.observations, 5);
  assert.equal(summary.recentMeans.length, 2);
  assert.deepEqual(memory.targets(), ['prompt']);
});

test('feedback memory recentMeans is bounded', () => {
  const memory = gepaFeedbackMemory({ recentLimit: 2 });
  for (let i = 0; i < 5; i += 1) memory.record('t', [fakeDatum(i / 10)]);
  assert.equal(memory.summarize('t').recentMeans.length, 2);
});

test('disjointTargets returns sorted set of differing components', () => {
  const a = {
    id: 'a',
    components: { p: '1', q: '2', r: '3' },
  } as GepaCandidate;
  const b = {
    id: 'b',
    components: { p: '1', q: 'X', r: '3', s: 'new' },
  } as GepaCandidate;
  assert.deepEqual(disjointTargets(a, b), ['q', 's']);
});

test('buildMergeChild returns null when parents are identical', () => {
  const a = { id: 'a', components: { p: 'x' } } as GepaCandidate;
  const b = { id: 'b', components: { p: 'x' } } as GepaCandidate;
  assert.equal(buildMergeChild({ parentA: a, parentB: b, rng: seededRng(1) }), null);
});

test('buildMergeChild picks disjoint targets from one of the two parents', () => {
  const a = { id: 'a', components: { p: 'A', q: 'A', r: 'shared' } } as GepaCandidate;
  const b = { id: 'b', components: { p: 'B', q: 'B', r: 'shared' } } as GepaCandidate;
  const proposal = buildMergeChild({ parentA: a, parentB: b, rng: seededRng(7) });
  assert.ok(proposal);
  assert.deepEqual(proposal.mergedTargets, ['p', 'q']);
  assert.equal(proposal.components.r, 'shared');
  for (const id of proposal.mergedTargets) {
    const value = proposal.components[id];
    assert.ok(value === a.components[id] || value === b.components[id]);
  }
});

test('pickMergePair returns null when front has fewer than two candidates', () => {
  const single = [{ id: 'only', components: {} } as GepaCandidate];
  assert.equal(pickMergePair(single, seededRng(1)), null);
});

test('proposer receives feedback memory rollup', async () => {
  const targets: GepaTarget[] = [{ id: 'prompt', kind: 'prompt', current: 'seed' }];
  const seenMemoryObservations: number[] = [];

  const adapter: GepaAdapter = {
    async evaluate({ candidate, tasks }): Promise<GepaEvaluateResult> {
      const variant = candidate.components.prompt ?? 'seed';
      const data: GepaReflectiveDatum[] = tasks.map((task, i) => ({
        example: task,
        trace: { steps: [], finalOutput: variant } as never,
        score: variant === 'better' ? 0.9 : 0.2 + i * 0.05,
        rubric: { score: 0.5, signals: [] },
      }));
      return { scores: data.map((d) => d.score), data };
    },
    async proposeNewText({ memory, current }) {
      seenMemoryObservations.push(memory?.observations ?? -1);
      return current === 'seed' ? 'better' : current;
    },
  };

  const source = proceduralTaskSource({
    id: 'proc',
    generate: ({ index }) => ({ id: `t-${index}`, input: `t-${index}` }),
  });

  const report = await optimizeGepa({
    seed: { components: { prompt: 'seed' } },
    targets,
    adapter,
    source,
    options: { maxIterations: 2, minibatchSize: 3, seed: 11, memoryTopK: 3 },
  });

  // proposer called at least once and saw memory with non-zero observations
  assert.ok(seenMemoryObservations.length >= 1);
  assert.ok((seenMemoryObservations[0] ?? 0) > 0);
  assert.equal(report.best.components.prompt, 'better');
});

test('merge step fires when the Pareto front holds non-dominated diverse members', async () => {
  const targets: GepaTarget[] = [
    { id: 'a', kind: 'prompt', current: 'seedA' },
    { id: 'b', kind: 'prompt', current: 'seedB' },
  ];

  // Score depends only on whether 'a' starts with 'good'; per-task scoring
  // alternates so multiple candidates can tie and stay on the Pareto front.
  // The proposer only ever fixes target 'a', producing many distinct 'b'
  // values across iterations — the front therefore holds several candidates
  // with identical scores but different components, which is exactly the
  // condition under which merge has something useful to do.
  let proposerCalls = 0;
  const adapter: GepaAdapter = {
    async evaluate({ candidate, tasks }) {
      const aGood = (candidate.components.a ?? '').startsWith('good');
      const data: GepaReflectiveDatum[] = tasks.map((task, i) => {
        const score = i % 2 === 0 && aGood ? 1 : 0;
        return {
          example: task,
          trace: { steps: [], finalOutput: candidate.components.a ?? '' } as never,
          score,
          rubric: { score, signals: [] },
        };
      });
      return { scores: data.map((d) => d.score), data };
    },
    async proposeNewText({ target, current }) {
      proposerCalls += 1;
      if (target.id === 'a') {
        return current.startsWith('good') ? current : `good-${proposerCalls}`;
      }
      // For target 'b' inject diversity without ever improving the score.
      return `alt-${proposerCalls}`;
    },
  };

  // Cycle two task ids so scoring is deterministic across iterations.
  const source = proceduralTaskSource({
    id: 'proc',
    generate: ({ index }) => ({ id: `t-${index % 2}`, input: `t-${index % 2}` }),
  });

  const report = await optimizeGepa({
    seed: { components: { a: 'seedA', b: 'seedB' } },
    targets,
    adapter,
    source,
    options: {
      maxIterations: 12,
      minibatchSize: 2,
      seed: 3,
      mergeProbability: 0.6,
    },
  });

  const mergeEvents = report.events.filter((event) => event.type === 'merge');
  assert.ok(mergeEvents.length > 0, 'expected at least one merge event');
  for (const event of mergeEvents) {
    if (event.type !== 'merge') continue;
    assert.equal(event.parentIds.length, 2);
    assert.notEqual(event.parentIds[0], event.parentIds[1]);
    assert.ok(event.mergedTargets.length > 0);
  }
  // Mutation should still have driven target 'a' into a 'good-*' variant.
  assert.ok((report.best.components.a ?? '').startsWith('good'));
});
