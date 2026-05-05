import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Message } from '@snapdragon-ai/host';
import type { SdBackgroundContext } from '../src/background.ts';
import { defaultSdConfig, type SdConfig } from '../src/config.ts';
import { createSdGatewayChannelStore } from '../src/gateway-channels.ts';
import {
  runSdGatewayChannelEventsOnce,
  type SdGatewayEventScanResult,
} from '../src/gateway-event-service.ts';
import { writeSdGatewayChannelEvent } from '../src/gateway-events-files.ts';
import {
  gatewayEventRootForConfig,
  type SdGatewayChannelEvent,
} from '../src/gateway-events-types.ts';
import type { SdMemoryProvider } from '../src/memory.ts';

const stubMemory: SdMemoryProvider = {
  describe: () => ({ id: 'stub', kind: 'memory' }),
  append: async () => ({ success: true }),
  read: async () => ({ entries: [] }),
};

test('channel event service runs due immediate events and records channel output', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-events-'));
  try {
    const config = eventConfig(workspace);
    const root = gatewayEventRootForConfig(config);
    await writeSdGatewayChannelEvent(root, {
      channel: 'nightly-quality',
      prompt: 'Summarize the nightly check.',
      title: 'Nightly Quality',
    });
    const calls: Message[][] = [];
    const result = await runScan(config, 1_000, calls, 'nightly result');

    assert.deepEqual(metrics(result), { claimed: 1, completed: 1, failed: 0, requeued: 0 });
    assert.match(String(calls[0]?.at(-1)?.content), /Summarize the nightly check/);
    assert.equal((await readdir(join(root, 'done'))).length, 1);

    const channel = createSdGatewayChannelStore(config).ensureSync('nightly-quality');
    const log = await readFile(channel.log_file, 'utf8');
    assert.match(log, /event\.started/);
    assert.match(log, /event\.completed/);
    const eventId = await doneEventId(root);
    assert.match(await readFile(join(channel.logs, `${eventId}.md`), 'utf8'), /nightly result/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('channel event service leaves future one-shot events pending', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-events-future-'));
  try {
    const config = eventConfig(workspace);
    const root = gatewayEventRootForConfig(config);
    await writeSdGatewayChannelEvent(root, {
      type: 'one-shot',
      channel: 'local:later',
      prompt: 'Not yet.',
      at: new Date(60_000).toISOString(),
    });
    const result = await runScan(config, 1_000, []);

    assert.deepEqual(metrics(result), { claimed: 0, completed: 0, failed: 0, requeued: 0 });
    assert.equal((await readdir(join(root, 'pending'))).length, 1);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('channel event service requeues successful periodic events', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-events-periodic-'));
  try {
    const config = eventConfig(workspace);
    const root = gatewayEventRootForConfig(config);
    const { event } = await writeSdGatewayChannelEvent(root, {
      id: 'heartbeat',
      type: 'periodic',
      channel: 'local:heartbeat',
      prompt: 'Heartbeat.',
      next_at: new Date(1_000).toISOString(),
      interval_ms: 5_000,
    });
    const result = await runScan(config, 2_000, [], 'ok');

    assert.deepEqual(metrics(result), { claimed: 1, completed: 0, failed: 0, requeued: 1 });
    const pending = JSON.parse(
      await readFile(join(root, 'pending', `${event.id}.json`), 'utf8'),
    ) as SdGatewayChannelEvent;
    assert.equal(pending.id, 'heartbeat');
    assert.equal(pending.next_at, new Date(7_000).toISOString());
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function runScan(
  config: SdConfig,
  now: number,
  calls: Message[][],
  response = 'ok',
): Promise<SdGatewayEventScanResult> {
  return runSdGatewayChannelEventsOnce({
    ctx: {
      config,
      memory: stubMemory,
      channels: createSdGatewayChannelStore(config),
      now: () => now,
      log: () => undefined,
      chat: async (messages) => {
        calls.push(messages);
        return { content: response };
      },
    } satisfies SdBackgroundContext,
  });
}

function eventConfig(root: string): SdConfig {
  return {
    ...defaultSdConfig(),
    background: {
      ...defaultSdConfig().background,
      daemon: { root: join(root, 'daemon'), auto_start: false },
      channels: {
        enabled: true,
        root: join(root, 'channels'),
        default_platform: 'local',
        events: {
          enabled: true,
          root: join(root, 'events'),
          max_events_per_pass: 2,
          max_tokens: 256,
        },
      },
    },
  };
}

function metrics(result: SdGatewayEventScanResult): Record<string, number> {
  return {
    claimed: result.claimed,
    completed: result.completed,
    failed: result.failed,
    requeued: result.requeued,
  };
}

async function doneEventId(root: string): Promise<string> {
  const [name] = await readdir(join(root, 'done'));
  return name.replace(/\.json$/, '');
}
