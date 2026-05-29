import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dominates,
  type GepaCandidate,
  type GepaTarget,
  gepaAdapter,
  manualProposer,
  optimizeGepa,
  paretoFront,
  proceduralTaskSource,
  seededRng,
  selectParent,
  validateTargetValue,
} from '../src/index.js';

const target: GepaTarget = {
  id: 'prompt',
  kind: 'instruction',
  current: 'You are a helpful assistant.',
  maxLength: 200,
  preserve: ['assistant'],
};

test('validateTargetValue enforces non-empty, maxLength, and preserve', () => {
  assert.equal(validateTargetValue(target, ''), 'value must be non-empty');
  assert.equal(validateTargetValue(target, 'a'.repeat(201)), 'value exceeds maxLength 200');
  assert.equal(
    validateTargetValue(target, 'just a helper'),
    'value missing required token: assistant',
  );
  assert.equal(validateTargetValue(target, 'You are an assistant.'), true);
});

test('validateTargetValue invokes user validate hook last', () => {
  const t: GepaTarget = {
    ...target,
    preserve: undefined,
    validate: (value) => (value.endsWith('.') ? true : 'must end with period'),
  };
  assert.equal(validateTargetValue(t, 'no period'), 'must end with period');
  assert.equal(validateTargetValue(t, 'fine.'), true);
});

test('dominates and paretoFront identify non-dominated candidates', () => {
  const mk = (id: string, t0: number, t1: number): GepaCandidate => ({
    id,
    components: {},
    scores: [t0, t1],
    scoresByTask: { t0, t1 },
    meanScore: (t0 + t1) / 2,
    generation: 0,
  });
  const candidates = [mk('a', 1, 0), mk('b', 0, 1), mk('c', 0.5, 0.5), mk('d', 0, 0)];
  assert.equal(dominates(candidates[0], candidates[3]), true);
  assert.equal(dominates(candidates[0], candidates[1]), false);
  const front = paretoFront(candidates)
    .map((c) => c.id)
    .sort();
  assert.deepEqual(front, ['a', 'b', 'c']);
});

test('dominates treats disjoint task sets as incomparable', () => {
  const a: GepaCandidate = {
    id: 'a',
    components: {},
    scores: [1, 1],
    scoresByTask: { t0: 1, t1: 1 },
    meanScore: 1,
    generation: 0,
  };
  const b: GepaCandidate = {
    id: 'b',
    components: {},
    scores: [0, 0],
    scoresByTask: { t2: 0, t3: 0 },
    meanScore: 0,
    generation: 0,
  };
  assert.equal(dominates(a, b), false);
  assert.equal(dominates(b, a), false);
  const front = paretoFront([a, b])
    .map((c) => c.id)
    .sort();
  assert.deepEqual(front, ['a', 'b']);
});

test('selectParent is deterministic with a seeded rng', () => {
  const front: GepaCandidate[] = [
    {
      id: 'a',
      components: {},
      scores: [1, 0],
      scoresByTask: { t0: 1, t1: 0 },
      meanScore: 0.5,
      generation: 0,
    },
    {
      id: 'b',
      components: {},
      scores: [0, 1],
      scoresByTask: { t0: 0, t1: 1 },
      meanScore: 0.5,
      generation: 0,
    },
  ];
  const rng = seededRng(42);
  const picks = Array.from({ length: 5 }, () => selectParent(front, { rng }).id);
  const rng2 = seededRng(42);
  const picks2 = Array.from({ length: 5 }, () => selectParent(front, { rng: rng2 }).id);
  assert.deepEqual(picks, picks2);
});

test('optimizeGepa runs end-to-end and finds the better variant', async () => {
  // Procedural source: every task asks the agent to greet by name.
  const source = proceduralTaskSource({
    id: 'greet',
    generate: ({ index }) => ({
      id: `g-${index}`,
      prompt: `Say hello to user ${index}`,
      metadata: { name: `user${index}` },
    }),
  });

  // Rollout: the candidate's `prompt` component contains the literal greeting
  // template. We "execute" by substituting the user name and counting whether
  // the template contains the word "Hello".
  const adapter = gepaAdapter({
    rubric: {
      id: 'contains-hello',
      async evaluate(_example, trace) {
        const text = trace.output;
        const score = text.toLowerCase().includes('hello') ? 1 : 0;
        return { score, signals: [{ id: 'hello', kind: 'programmatic', weight: 1, score }] };
      },
    },
    async runRollout(candidate, _targets, example) {
      const template = candidate.components.prompt ?? '';
      const name = (example.metadata?.name as string) ?? 'friend';
      return { exampleId: example.id, output: template.replace('{name}', name), toolCalls: [] };
    },
    proposeNewText: manualProposer({
      prompt: ['Hi {name}!', 'Hello, {name}!'],
    }),
  });

  const report = await optimizeGepa({
    seed: { components: { prompt: 'Hi {name}!' } },
    targets: [{ id: 'prompt', kind: 'instruction', current: 'Hi {name}!' }],
    adapter,
    source,
    options: { maxIterations: 4, minibatchSize: 3, seed: 7 },
  });

  assert.equal(report.best.components.prompt, 'Hello, {name}!');
  assert.equal(report.best.meanScore, 1);
  assert.equal(report.improved, true);
  assert.ok(report.events.some((e) => e.type === 'started'));
  assert.ok(report.events.some((e) => e.type === 'completed'));
  assert.ok(report.evals >= 2);
});

test('optimizeGepa rejects proposals that fail validation', async () => {
  const source = proceduralTaskSource({
    id: 'noop',
    generate: ({ index }) => ({ id: `n-${index}`, prompt: '' }),
  });
  const adapter = gepaAdapter({
    rubric: {
      id: 'always-zero',
      async evaluate() {
        return { score: 0, signals: [] };
      },
    },
    async runRollout(candidate, _targets, example) {
      return { exampleId: example.id, output: candidate.components.prompt ?? '', toolCalls: [] };
    },
    // Proposer returns an empty string — should always fail validation.
    proposeNewText: async () => '',
  });

  const report = await optimizeGepa({
    seed: { components: { prompt: 'seed' } },
    targets: [{ id: 'prompt', kind: 'instruction', current: 'seed' }],
    adapter,
    source,
    options: { maxIterations: 3, minibatchSize: 2, seed: 1 },
  });

  const rejections = report.events.filter((e) => e.type === 'rejected');
  assert.ok(rejections.length >= 1);
  assert.equal(report.best.components.prompt, 'seed');
  assert.equal(report.improved, false);
});

test('optimizeGepa respects AbortSignal', async () => {
  const source = proceduralTaskSource({
    id: 'noop',
    generate: ({ index }) => ({ id: `n-${index}`, prompt: '' }),
  });
  const controller = new AbortController();
  controller.abort();
  const adapter = gepaAdapter({
    rubric: {
      id: 'z',
      async evaluate() {
        return { score: 0, signals: [] };
      },
    },
    async runRollout(_c, _t, example) {
      return { exampleId: example.id, output: '', toolCalls: [] };
    },
    proposeNewText: async () => 'whatever',
  });
  const report = await optimizeGepa({
    seed: { components: { prompt: 'seed' } },
    targets: [{ id: 'prompt', kind: 'instruction', current: 'seed' }],
    adapter,
    source,
    options: { maxIterations: 10, minibatchSize: 2, signal: controller.signal },
  });
  assert.equal(report.iterations, 0);
});
