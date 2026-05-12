import assert from 'node:assert/strict';
import test from 'node:test';
import {
  antiGamingRubric,
  createAntiGamingVerifiers,
  createPrimeTrainingConfig,
  evaluateDataset,
  evaluateVerifiers,
  expectedToolCallsVerifier,
  forbiddenToolsVerifier,
  type LearningDataset,
  learnEvalJobToGatewayJob,
  learnJobToGatewayJob,
  maxToolCallsVerifier,
  noConsecutiveDuplicateToolsVerifier,
  noRepeatedFailedToolCallsVerifier,
  outputContainsVerifier,
  primeBackend,
  requiredToolsVerifier,
  requiredToolUseVerifier,
  toolSuccessVerifier,
} from '../src/index.js';

test('antiGamingRubric catches missing required tool use', async () => {
  const result = await antiGamingRubric().evaluate(
    { id: '1', prompt: 'read file', requiresTools: true },
    { exampleId: '1', output: 'done', toolCalls: [] },
  );
  const signal = result.signals.find((entry) => entry.id === 'tool_use_required');
  assert.equal(signal?.score, 0);
  assert.ok(result.score < 1);
});

test('primeBackend creates a Prime-shaped training config', () => {
  const dataset: LearningDataset = { id: 'anarion/pi_agent_env', examples: [] };
  const config = primeBackend.createConfig(
    { id: 'job', kind: 'rl', dataset: dataset.id, model: 'Qwen/Qwen3', maxSteps: 1000 },
    dataset,
  );
  assert.equal(config.model, 'Qwen/Qwen3');
  assert.equal(config.max_steps, 1000);
  assert.equal(config.env?.[0]?.id, 'anarion/pi_agent_env');
  assert.equal(config.buffer?.online_difficulty_filtering, true);
});

test('createPrimeTrainingConfig supports hosted training fields', () => {
  const dataset: LearningDataset = {
    id: 'snapdragon/tool-env',
    examples: [],
    environments: [{ id: 'team/snapdragon-tool-env', kind: 'prime', args: { split: 'train' } }],
  };
  const config = createPrimeTrainingConfig(
    {
      id: 'train-1',
      kind: 'rl',
      dataset: dataset.id,
      model: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
      maxSteps: 1000,
    },
    dataset,
    {
      batch_size: 256,
      rollouts_per_example: 8,
      learning_rate: 1e-4,
      sampling: { max_tokens: 4096, enable_thinking: false },
      checkpoints: { interval: 50, keep_cloud: 5 },
      evalEnvironment: {
        id: 'team/snapdragon-tool-env',
        args: { split: 'test' },
        num_examples: 50,
      },
      infrastructure: { compute_size: 'M' },
    },
  );

  assert.equal(config.env?.[0]?.id, 'team/snapdragon-tool-env');
  assert.deepEqual(config.env?.[0]?.args, { split: 'train' });
  assert.equal(config.batch_size, 256);
  assert.equal(config.rollouts_per_example, 8);
  assert.equal(config.sampling?.max_tokens, 4096);
  assert.equal(config.checkpoints?.interval, 50);
  assert.equal(config.eval?.env?.[0]?.args?.split, 'test');
  assert.equal(config.infrastructure?.compute_size, 'M');
});

test('evaluateDataset produces per-example results, verifier results, and gateway job mapping', async () => {
  const dataset: LearningDataset = {
    id: 'evals/basic',
    examples: [{ id: '1', prompt: 'read file', requiresTools: true, maxToolCalls: 2 }],
  };
  const result = await evaluateDataset(
    { id: 'eval-1', kind: 'eval', dataset: dataset.id },
    dataset,
    antiGamingRubric(),
    async (example) => ({
      exampleId: example.id,
      output: 'done',
      toolCalls: [{ name: 'read_file', input: { path: 'README.md' }, success: true }],
    }),
    { verifiers: [requiredToolUseVerifier(), toolSuccessVerifier(), maxToolCallsVerifier()] },
  );
  assert.equal(result.examples, 1);
  assert.equal(result.exampleResults?.[0]?.exampleId, '1');
  assert.equal(
    result.exampleResults?.[0]?.verifierResults?.every((entry) => entry.passed),
    true,
  );
  assert.equal(result.exampleResults?.[0]?.verifierSummary?.passed, true);
  assert.equal(result.events.at(-1)?.type, 'completed');
  assert.equal(
    learnJobToGatewayJob({ id: 'eval-1', kind: 'eval', dataset: dataset.id }).kind,
    'learn.eval',
  );
  assert.equal(
    learnEvalJobToGatewayJob({ id: 'eval-1', kind: 'eval', dataset: dataset.id }, dataset).payload
      .dataset.id,
    dataset.id,
  );
});

test('anti-gaming verifiers catch redundant and repeated failed tool calls', async () => {
  const rollout = {
    exampleId: '1',
    output: 'failed',
    toolCalls: [
      { name: 'read', input: { path: 'missing' }, success: false, error: 'not found' },
      { name: 'read', input: { path: 'missing' }, success: false, error: 'not found' },
    ],
  };

  const duplicate = await noConsecutiveDuplicateToolsVerifier().verify(
    { id: '1', prompt: 'x' },
    rollout,
  );
  const repeatedFailure = await noRepeatedFailedToolCallsVerifier().verify(
    { id: '1', prompt: 'x' },
    rollout,
  );

  assert.equal(duplicate.passed, false);
  assert.equal(duplicate.issues[0]?.id, 'consecutive-duplicate-tool');
  assert.equal(repeatedFailure.passed, false);
  assert.equal(repeatedFailure.issues[0]?.id, 'repeated-failed-tool-call');
});

test('verifier helpers catch required, forbidden, expected, and output evidence failures', async () => {
  const example = {
    id: '1',
    prompt: 'inspect package',
    requiredTools: ['read_file'],
    forbiddenTools: ['curl'],
    expectedOutputContains: ['version'],
    expectedToolCalls: [
      { name: 'read_file', inputContains: { path: 'package.json' }, outputContains: 'name' },
    ],
  };
  const rollout = {
    exampleId: '1',
    output: 'no useful answer',
    toolCalls: [{ name: 'curl', input: { url: 'https://example.com' }, success: true, output: '' }],
  };

  const summary = await evaluateVerifiers(
    [
      requiredToolsVerifier(),
      forbiddenToolsVerifier(),
      expectedToolCallsVerifier(),
      outputContainsVerifier(),
    ],
    example,
    rollout,
    'weighted',
  );

  assert.equal(summary.passed, false);
  assert.equal(summary.failedCount, 4);
  assert.ok(summary.score < 1);
  assert.equal(summary.results[0]?.issues[0]?.id, 'missing-required-tool');
  assert.equal(summary.results[1]?.issues[0]?.id, 'forbidden-tool-used');
  assert.equal(summary.results[2]?.issues[0]?.id, 'missing-expected-tool-call');
  assert.equal(summary.results[3]?.issues[0]?.id, 'missing-output-fragment');
});

test('createAntiGamingVerifiers returns a reusable verifier bundle', async () => {
  const summary = await evaluateVerifiers(
    createAntiGamingVerifiers({ minOutputLength: 5 }),
    { id: '1', prompt: 'answer', requiresTools: true, maxToolCalls: 1 },
    {
      exampleId: '1',
      output: 'ok',
      toolCalls: [
        { name: 'read', input: { path: 'missing' }, success: false, error: 'missing' },
        { name: 'read', input: { path: 'missing' }, success: false, error: 'missing' },
      ],
    },
  );

  assert.equal(summary.passed, false);
  assert.ok(summary.failedCount >= 3);
});

test('evaluateDataset can continue after rollout errors', async () => {
  const dataset: LearningDataset = {
    id: 'evals/errors',
    examples: [
      { id: 'bad', prompt: 'bad' },
      { id: 'good', prompt: 'good' },
    ],
  };
  const result = await evaluateDataset(
    { id: 'eval-errors', kind: 'eval', dataset: dataset.id },
    dataset,
    antiGamingRubric(),
    async (example) => {
      if (example.id === 'bad') {
        throw new Error('rollout failed');
      }
      return { exampleId: example.id, output: 'ok', toolCalls: [] };
    },
    { continueOnError: true },
  );

  assert.equal(result.exampleResults?.[0]?.error, 'rollout failed');
  assert.equal(result.exampleResults?.[1]?.exampleId, 'good');
  assert.equal(
    result.events.some((event) => event.type === 'failed'),
    true,
  );
});
