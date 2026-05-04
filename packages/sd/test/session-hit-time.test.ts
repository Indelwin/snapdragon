import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHitTimestamp } from '../src/session-hit-time.ts';

test('formatHitTimestamp treats numbers as Unix seconds (the session-store format)', () => {
  // 2025-04-30 00:33:06 UTC = 1745973186 seconds
  const seconds = 1745973186;
  assert.equal(formatHitTimestamp(seconds), '2025-04-30 00:33:06');
});

test('formatHitTimestamp passes through values that already look like milliseconds', () => {
  const ms = 1745973186000;
  assert.equal(formatHitTimestamp(ms), '2025-04-30 00:33:06');
});

test('formatHitTimestamp returns empty string for missing/invalid values', () => {
  assert.equal(formatHitTimestamp(undefined), '');
  assert.equal(formatHitTimestamp(null), '');
  assert.equal(formatHitTimestamp(0), '');
  assert.equal(formatHitTimestamp(Number.NaN), '');
});
