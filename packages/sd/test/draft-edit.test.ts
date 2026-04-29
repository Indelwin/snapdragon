import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteBackwardChar,
  deleteBackwardWord,
  deleteForwardChar,
  insertAt,
  locateCursor,
  moveCharLeft,
  moveCharRight,
  moveLineEnd,
  moveLineStart,
  moveWordLeft,
  moveWordRight,
  wordBoundaryLeft,
  wordBoundaryRight,
} from '../src/tui/draft-edit.ts';

test('insertAt inserts at the cursor and advances by chunk length', () => {
  assert.deepEqual(insertAt({ text: 'hi', cursor: 1 }, 'X'), { text: 'hXi', cursor: 2 });
  assert.deepEqual(insertAt({ text: '', cursor: 0 }, 'abc'), { text: 'abc', cursor: 3 });
  assert.deepEqual(insertAt({ text: 'hi', cursor: 2 }, '!'), { text: 'hi!', cursor: 3 });
});

test('insertAt clamps a negative or out-of-range cursor', () => {
  assert.deepEqual(insertAt({ text: 'hi', cursor: -5 }, 'X'), { text: 'Xhi', cursor: 1 });
  assert.deepEqual(insertAt({ text: 'hi', cursor: 99 }, 'X'), { text: 'hiX', cursor: 3 });
});

test('deleteBackwardChar removes the char before the cursor', () => {
  assert.deepEqual(deleteBackwardChar({ text: 'abc', cursor: 2 }), { text: 'ac', cursor: 1 });
  assert.deepEqual(deleteBackwardChar({ text: 'abc', cursor: 0 }), { text: 'abc', cursor: 0 });
  assert.deepEqual(deleteBackwardChar({ text: 'abc', cursor: 3 }), { text: 'ab', cursor: 2 });
});

test('deleteForwardChar removes the char at the cursor', () => {
  assert.deepEqual(deleteForwardChar({ text: 'abc', cursor: 1 }), { text: 'ac', cursor: 1 });
  assert.deepEqual(deleteForwardChar({ text: 'abc', cursor: 3 }), { text: 'abc', cursor: 3 });
});

test('moveCharLeft / moveCharRight clamp at boundaries', () => {
  assert.equal(moveCharLeft({ text: 'abc', cursor: 0 }).cursor, 0);
  assert.equal(moveCharLeft({ text: 'abc', cursor: 2 }).cursor, 1);
  assert.equal(moveCharRight({ text: 'abc', cursor: 3 }).cursor, 3);
  assert.equal(moveCharRight({ text: 'abc', cursor: 1 }).cursor, 2);
});

test('wordBoundaryLeft jumps past trailing non-word chars then over the word', () => {
  // From end of "foo bar baz", word-back lands at start of "baz".
  assert.equal(wordBoundaryLeft('foo bar baz', 11), 8);
  // From mid-word, lands at start of that word.
  assert.equal(wordBoundaryLeft('foo bar baz', 6), 4);
  // From a run of spaces between words, lands at start of preceding word.
  assert.equal(wordBoundaryLeft('foo   bar', 5), 0);
  // Already at start.
  assert.equal(wordBoundaryLeft('foo', 0), 0);
});

test('wordBoundaryRight skips leading non-word chars then over the word', () => {
  assert.equal(wordBoundaryRight('foo bar baz', 0), 3);
  assert.equal(wordBoundaryRight('foo bar baz', 3), 7);
  assert.equal(wordBoundaryRight('foo   bar', 3), 9);
  assert.equal(wordBoundaryRight('foo bar', 7), 7);
});

test('moveWordLeft / moveWordRight delegate to boundary helpers', () => {
  assert.equal(moveWordLeft({ text: 'foo bar', cursor: 7 }).cursor, 4);
  assert.equal(moveWordRight({ text: 'foo bar', cursor: 0 }).cursor, 3);
});

test('deleteBackwardWord removes from cursor back to previous word boundary', () => {
  assert.deepEqual(deleteBackwardWord({ text: 'foo bar baz', cursor: 11 }), {
    text: 'foo bar ',
    cursor: 8,
  });
  assert.deepEqual(deleteBackwardWord({ text: 'foo bar', cursor: 4 }), {
    text: 'bar',
    cursor: 0,
  });
  // Trailing whitespace + word: word delete eats both.
  assert.deepEqual(deleteBackwardWord({ text: 'hello   ', cursor: 8 }), {
    text: '',
    cursor: 0,
  });
});

test('moveLineStart / moveLineEnd snap to the current logical line', () => {
  // Multi-line draft: "alpha\nbravo\ncharlie", cursor mid-bravo.
  const text = 'alpha\nbravo\ncharlie';
  const cursor = 8; // 'a' of 'bravo' is index 6, so 8 = 'a'+2 = inside "br|avo"
  assert.equal(moveLineStart({ text, cursor }).cursor, 6);
  assert.equal(moveLineEnd({ text, cursor }).cursor, 11);
  // First line.
  assert.equal(moveLineStart({ text, cursor: 3 }).cursor, 0);
  assert.equal(moveLineEnd({ text, cursor: 3 }).cursor, 5);
});

test('locateCursor returns (line, column) for a multi-line draft', () => {
  const text = 'one\ntwo\nthree';
  assert.deepEqual(locateCursor(text, 0), { line: 0, column: 0 });
  assert.deepEqual(locateCursor(text, 3), { line: 0, column: 3 });
  assert.deepEqual(locateCursor(text, 4), { line: 1, column: 0 });
  assert.deepEqual(locateCursor(text, 6), { line: 1, column: 2 });
  assert.deepEqual(locateCursor(text, 13), { line: 2, column: 5 });
});

test('locateCursor clamps an out-of-range cursor', () => {
  assert.deepEqual(locateCursor('abc', 99), { line: 0, column: 3 });
  assert.deepEqual(locateCursor('abc', -1), { line: 0, column: 0 });
});
