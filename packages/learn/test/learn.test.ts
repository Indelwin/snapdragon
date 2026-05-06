import assert from 'node:assert/strict';
import test from 'node:test';
import {
  antiGamingRubric,
  evaluateDataset,
  type LearningDataset,
  learnEvalJobToGatewayJob,
  learnJobToGatewayJob,
  primeBackend,
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

test('evaluateDataset produces a local eval result and gateway job mapping', async () => {
  const dataset: LearningDataset = {
    id: 'evals/basic',
    examples: [{ id: '1', prompt: 'read file', requiresTools: true }],
  };
  const result = await evaluateDataset(
    { id: 'eval-1', kind: 'eval', dataset: dataset.id },
    dataset,
    antiGamingRubric(),
    async (example) => ({
      exampleId: example.id,
      output: 'done',
      toolCalls: [{ name: 'read_file', success: true }],
    }),
  );
  assert.equal(result.examples, 1);
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
