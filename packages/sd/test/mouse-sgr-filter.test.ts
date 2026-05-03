import assert from 'node:assert/strict';
import test from 'node:test';
import { isMouseSgrSequence } from '../src/tui/mouse-sgr-filter.ts';

test('isMouseSgrSequence matches xterm SGR mouse press/release/wheel sequences', () => {
  // After Ink strips the leading ESC byte these are the residue bytes that
  // `useInput` forwards as `input`.
  assert.equal(isMouseSgrSequence('[<0;10;5M'), true, 'left press');
  assert.equal(isMouseSgrSequence('[<0;10;5m'), true, 'left release');
  assert.equal(isMouseSgrSequence('[<2;120;40M'), true, 'right press');
  assert.equal(isMouseSgrSequence('[<32;10;5M'), true, 'motion');
  assert.equal(isMouseSgrSequence('[<64;10;5M'), true, 'wheel up');
  assert.equal(isMouseSgrSequence('[<65;10;5M'), true, 'wheel down');
  assert.equal(isMouseSgrSequence('[<35;200;200M'), true, 'large coords');
});

test('isMouseSgrSequence rejects ordinary input and near-misses', () => {
  assert.equal(isMouseSgrSequence(''), false);
  assert.equal(isMouseSgrSequence('a'), false);
  assert.equal(isMouseSgrSequence('hello'), false);
  assert.equal(isMouseSgrSequence('[<0;10;5'), false, 'missing terminator');
  assert.equal(isMouseSgrSequence('[<0;10M'), false, 'missing third coord');
  assert.equal(isMouseSgrSequence('[<a;10;5M'), false, 'non-numeric button');
  assert.equal(isMouseSgrSequence('[A'), false, 'plain CSI A (arrow)');
  assert.equal(isMouseSgrSequence('[<0;10;5MX'), false, 'trailing junk');
  assert.equal(isMouseSgrSequence('x[<0;10;5M'), false, 'leading junk');
  assert.equal(isMouseSgrSequence('[<0;1;1;1M'), false, 'too many coords');
});

test('isMouseSgrSequence is bounded so it never gets fed pathological input', () => {
  const long = `[<${'9'.repeat(200)};10;5M`;
  assert.equal(isMouseSgrSequence(long), false);
});
