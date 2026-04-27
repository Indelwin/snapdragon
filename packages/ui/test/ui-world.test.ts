import assert from 'node:assert/strict';
import test from 'node:test';
import { UiWorld, uiLog } from '../src/index.ts';

test('UiWorld registers, orders, and removes components', () => {
  const world = new UiWorld();
  world.apply({
    type: 'ui.component.register',
    descriptor: { id: 'later', kind: 'event.log', slot: 'panel', order: 2 },
  });
  world.apply({
    type: 'ui.component.register',
    descriptor: { id: 'first', kind: 'run.status', slot: 'panel', order: 1 },
  });

  assert.deepEqual(
    world.componentsInSlot('panel').map((component) => component.descriptor.id),
    ['first', 'later'],
  );

  world.apply({ type: 'ui.component.remove', id: 'first' });
  assert.equal(world.component('first'), undefined);
});

test('UiWorld applies state patches without mutating snapshots', () => {
  const world = new UiWorld();
  world.apply({
    type: 'ui.component.register',
    descriptor: { id: 'status', kind: 'run.status', slot: 'status' },
    state: { run: { status: 'idle', count: 0 }, stale: true },
  });
  world.apply({
    type: 'ui.component.patch',
    id: 'status',
    patch: { run: { status: 'running' }, stale: null },
  });

  const snapshot = world.component('status');
  assert.deepEqual(snapshot?.state, { run: { status: 'running', count: 0 } });
  if (snapshot) snapshot.state.run = { status: 'changed' };
  assert.deepEqual(world.component('status')?.state, {
    run: { status: 'running', count: 0 },
  });
});

test('UiWorld tracks focus, logs, and deterministic replay', () => {
  const events = [
    {
      type: 'ui.component.register' as const,
      descriptor: { id: 'prompt', kind: 'prompt.input', slot: 'input' },
    },
    { type: 'ui.focus.set' as const, id: 'prompt' },
    { type: 'ui.log.append' as const, entry: uiLog('info', 'ready', { id: 'log_1' }) },
  ];

  const one = new UiWorld();
  const two = new UiWorld();
  one.applyMany(events);
  two.applyMany(events);

  assert.equal(one.focusId, 'prompt');
  assert.equal(one.log[0]?.message, 'ready');
  assert.deepEqual(one.snapshot().components, two.snapshot().components);
});
