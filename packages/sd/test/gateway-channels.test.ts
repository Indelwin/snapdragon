import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultSdConfig } from '../src/config.ts';
import {
  channelRootForTarget,
  createSdGatewayChannelStore,
  gatewayChannelRootForConfig,
  normalizeGatewayChannelTarget,
} from '../src/gateway-channels.ts';

test('normalizes channel targets with a default local platform', () => {
  assert.deepEqual(normalizeGatewayChannelTarget('nightly'), {
    platform: 'local',
    id: 'nightly',
    target: 'local:nightly',
  });
  assert.deepEqual(normalizeGatewayChannelTarget('GitHub:Indelwin/snapdragon'), {
    platform: 'github',
    id: 'Indelwin/snapdragon',
    target: 'github:Indelwin/snapdragon',
  });
  assert.throws(() => normalizeGatewayChannelTarget(''), /required/);
  assert.throws(() => normalizeGatewayChannelTarget('bad platform:id'), /Invalid/);
});

test('creates channel homes and preserves descriptor metadata', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-channels-'));
  const config = {
    ...defaultSdConfig(),
    background: {
      ...defaultSdConfig().background,
      channels: { enabled: true, root: workspace, default_platform: 'local' },
    },
  };
  try {
    const store = createSdGatewayChannelStore(config);
    const channel = await store.ensure('nightly-quality', {
      name: 'Nightly Quality',
      type: 'scheduled',
      metadata: { cadence: 'daily' },
    });
    assert.equal(channel.target, 'local:nightly-quality');
    assert.equal(channel.name, 'Nightly Quality');
    assert.equal(channel.metadata?.cadence, 'daily');
    assert.equal(channel.root, channelRootForTarget(workspace, channel));

    const listed = await store.list({ platform: 'local' });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.target, 'local:nightly-quality');

    await store.appendLog('nightly-quality', { type: 'trigger', message: 'queued' });
    const log = await readFile(channel.log_file, 'utf8');
    assert.match(log, /"type":"trigger"/);
    assert.match(log, /"message":"queued"/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('derives channel root from daemon root unless configured directly', () => {
  const config = {
    ...defaultSdConfig(),
    background: {
      ...defaultSdConfig().background,
      daemon: { root: '/tmp/sd-daemon-test', auto_start: false },
    },
  };
  assert.equal(gatewayChannelRootForConfig(config), '/tmp/sd-daemon-test/channels');
});
