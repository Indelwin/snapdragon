import assert from 'node:assert/strict';
import test from 'node:test';
import { antiGamingRubric, type LearningDataset, primeBackend } from '../src/index.js';

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
