import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayClient, GatewayJobStatus, GatewayLeaseFence } from '@snapdragon-ai/gateway';
import { settleLearnJobFailure } from '../src/gateway-learn-job-failure.ts';

const job: GatewayJobStatus = {
  id: 'learn-job',
  spec: {
    kind: 'learn.eval',
    queue: 'learn',
    payload: undefined,
    priority: 0,
    maxAttempts: 3,
  },
  state: 'running',
  attempts: 1,
  createdAtMs: 1,
  updatedAtMs: 2,
  leaseId: 'lease-1',
  leaseAttempt: 1,
  leaseExpiresAtMs: 10_000,
};

const fence: GatewayLeaseFence = { leaseId: 'lease-1', attempt: 1 };

function clientWith(overrides: {
  showJob?: GatewayClient['showJob'];
  failJob?: GatewayClient['failJob'];
}): GatewayClient {
  return {
    showJob: overrides.showJob ?? (async () => job),
    failJob: overrides.failJob ?? (async () => ({ ...job, state: 'failed' })),
  } as unknown as GatewayClient;
}

test('learn failure settlement short-circuits an observed monitor cancellation', async () => {
  let statusCalls = 0;
  let failCalls = 0;
  const client = clientWith({
    showJob: async () => {
      statusCalls += 1;
      return job;
    },
    failJob: async () => {
      failCalls += 1;
      return job;
    },
  });

  const result = await settleLearnJobFailure(
    client,
    job,
    fence,
    { cancelled: true, leaseLost: false },
    17,
  );

  assert.deepEqual(result, { cancelled: true, message: '17' });
  assert.equal(statusCalls, 0);
  assert.equal(failCalls, 0);
});

test('learn failure settlement recognizes cancellation reported by the gateway', async () => {
  let failCalls = 0;
  const client = clientWith({
    showJob: async () => ({ ...job, state: 'cancelled' }),
    failJob: async () => {
      failCalls += 1;
      return job;
    },
  });

  const result = await settleLearnJobFailure(
    client,
    job,
    fence,
    { cancelled: false, leaseLost: false },
    new Error('cancelled work'),
  );

  assert.deepEqual(result, { cancelled: true, message: 'cancelled work' });
  assert.equal(failCalls, 0);
});

test('learn failure settlement fences a still-running job failure', async () => {
  const failures: Array<{ id: string; message: string; fence: GatewayLeaseFence }> = [];
  const client = clientWith({
    failJob: async (id, message, lease) => {
      failures.push({ id, message, fence: lease });
      return { ...job, state: 'failed', lastError: message };
    },
  });

  const result = await settleLearnJobFailure(
    client,
    job,
    fence,
    { cancelled: false, leaseLost: false },
    new Error('evaluation failed'),
  );

  assert.deepEqual(result, { cancelled: false, message: 'evaluation failed' });
  assert.deepEqual(failures, [{ id: job.id, message: 'evaluation failed', fence }]);
});

test('learn failure settlement does not write after lease loss or terminal state', async (t) => {
  for (const scenario of [
    { name: 'lease lost', leaseLost: true, state: 'running' as const },
    { name: 'already failed', leaseLost: false, state: 'failed' as const },
  ]) {
    await t.test(scenario.name, async () => {
      let failCalls = 0;
      const client = clientWith({
        showJob: async () => ({ ...job, state: scenario.state }),
        failJob: async () => {
          failCalls += 1;
          return job;
        },
      });

      const result = await settleLearnJobFailure(
        client,
        job,
        fence,
        { cancelled: false, leaseLost: scenario.leaseLost },
        new Error('evaluation failed'),
      );

      assert.deepEqual(result, { cancelled: false, message: 'evaluation failed' });
      assert.equal(failCalls, 0);
    });
  }
});

test('learn failure settlement treats cancellation racing failJob as terminal', async () => {
  let statusCalls = 0;
  const client = clientWith({
    showJob: async () => {
      statusCalls += 1;
      return { ...job, state: statusCalls === 3 ? 'cancelled' : 'running' };
    },
    failJob: async () => {
      throw new Error('stale lease');
    },
  });

  const result = await settleLearnJobFailure(
    client,
    job,
    fence,
    { cancelled: false, leaseLost: false },
    new Error('evaluation failed'),
  );

  assert.deepEqual(result, { cancelled: true, message: 'evaluation failed' });
  assert.equal(statusCalls, 3);
});

test('learn failure settlement reports a rejected failure update', async (t) => {
  for (const scenario of [
    { name: 'Error rejection', failure: new Error('stale lease'), detail: 'stale lease' },
    { name: 'non-Error rejection', failure: 'closed transport', detail: 'closed transport' },
  ]) {
    await t.test(scenario.name, async () => {
      let statusCalls = 0;
      const client = clientWith({
        showJob: async () => {
          statusCalls += 1;
          if (statusCalls === 3 && scenario.name === 'non-Error rejection') {
            throw new Error('status unavailable');
          }
          return job;
        },
        failJob: async () => {
          throw scenario.failure;
        },
      });

      const result = await settleLearnJobFailure(
        client,
        job,
        fence,
        { cancelled: false, leaseLost: false },
        new Error('evaluation failed'),
      );

      assert.deepEqual(result, {
        cancelled: false,
        message: `evaluation failed; failure update not applied: ${scenario.detail}`,
      });
    });
  }
});
