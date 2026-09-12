import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const target = process.env.INK_CACHE_TEST_TARGET ?? 'src';
if (target !== 'src' && target !== 'dist') {
  throw new Error(`INK_CACHE_TEST_TARGET must be "src" or "dist", received ${target}`);
}

const implementationDirectory = target === 'src' ? '../src/' : '../dist/build/';
const { TextCache } = await import(
  new URL(`${implementationDirectory}text-cache.js`, import.meta.url)
);
const wrapText = (await import(new URL(`${implementationDirectory}wrap-text.js`, import.meta.url)))
  .default;

const memoryProbe = `
  import assert from 'node:assert/strict';

  const [moduleUrl, operation] = process.argv.slice(1);
  const { default: renderText } = await import(moduleUrl);
  const mib = 1024 * 1024;

  for (let index = 0; index < 3; index++) global.gc();
  const baselineExternal = process.memoryUsage().external;

  let parent = Buffer.alloc(64 * mib, 1).toString('utf16le');
  let input = parent.slice(1024, 1088);
  if (operation === 'measure') {
    renderText(input);
    renderText(input);
  } else {
    renderText(input, 128, 'truncate');
    renderText(input, 128, 'truncate');
  }

  parent = undefined;
  input = undefined;
  for (let index = 0; index < 5; index++) global.gc();

  const retainedExternal = process.memoryUsage().external - baselineExternal;
  assert.ok(
    retainedExternal < 16 * mib,
    operation + ' retained ' + Math.round(retainedExternal / mib) + ' MiB of parent storage',
  );
`;

const assertParentStorageReleased = (moduleName, operation) => {
  const moduleUrl = new URL(`${implementationDirectory}${moduleName}`, import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--max-old-space-size=256',
      '--input-type=module',
      '--eval',
      memoryProbe,
      moduleUrl,
      operation,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    child.status,
    0,
    `child process failed\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
  );
};

test('cache evicts least recently used entries and accounts replacement bytes', () => {
  const cache = new TextCache(2, 1000);
  cache.set('a', 'a');
  cache.set('b', 'b');
  assert.equal(cache.get('a'), 'a');
  cache.set('c', 'c');
  assert.equal(cache.get('b'), undefined);
  cache.set('a', 'longer');
  assert.equal(cache.size, 2);
  assert.equal(cache.bytes, 274);
});

test('byte budget evicts and oversized values are not retained', () => {
  const cache = new TextCache(100, 300);
  for (let i = 0; i < 10000; i++) cache.set(String(i), 'x'.repeat(50));
  assert.equal(cache.size, 1);
  assert.ok(cache.bytes <= 300);
  cache.set('huge', 'x'.repeat(1000));
  assert.equal(cache.get('huge'), undefined);

  const replacementCache = new TextCache(10, 300);
  replacementCache.set('same', 'small');
  replacementCache.set('same', 'x'.repeat(1000));
  assert.equal(replacementCache.get('same'), undefined);
  assert.equal(replacementCache.size, 0);
  assert.equal(replacementCache.bytes, 0);
});

test('string keys and values preserve ANSI, Unicode, and unpaired surrogates', () => {
  const cache = new TextCache();
  const entries = [
    ['\u001B[31mred\u001B[0m', '\u001B[1mgreen\u001B[0m'],
    ['Espa\u00F1a \u6F22\u5B57 \uD83D\uDE42', '\uD83D\uDE80 na\u00EFve caf\u00E9'],
    ['high-\uD800-surrogate', 'low-\uDC00-surrogate'],
    ['reversed-\uDC00\uD800-pair', 'mixed-\uD800A\uDC00-value'],
  ];

  for (const [key, value] of entries) cache.set(key, value);
  for (const [key, value] of entries) assert.equal(cache.get(key), value);
});

test('non-string keys are rejected without corrupting accounting', () => {
  const cache = new TextCache();
  for (const key of [NaN, undefined, null, 1, {}, Symbol('key')]) {
    assert.throws(() => cache.set(key, 'value'), TypeError);
  }
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
});

test('default entry and byte budgets hold under high unique content', () => {
  const cache = new TextCache();
  for (let index = 0; index < 5000; index++) {
    cache.set(`small-key-${index}`, `small-value-${index}`);
  }
  assert.equal(cache.size, 4096);
  assert.ok(cache.bytes <= 8 * 1024 * 1024);
  assert.equal(cache.get('small-key-0'), undefined);

  for (let index = 0; index < 10_000; index++) {
    cache.set(`large-key-${index}`, `unique-${index}-${'x'.repeat(1024)}`);
  }
  assert.ok(cache.size < 4096);
  assert.ok(cache.bytes <= 8 * 1024 * 1024);
  assert.equal(cache.get('large-key-0'), undefined);
  assert.equal(cache.get('large-key-9999'), `unique-9999-${'x'.repeat(1024)}`);
});

test('wrap cache keys do not collide across text and width boundaries', () => {
  assert.equal(wrapText('a1', 2, 'hard'), 'a1');
  assert.equal(wrapText('a', 12, 'hard'), 'a');
});

test('measure cache releases large parent string storage after insertion', () => {
  assertParentStorageReleased('measure-text.js', 'measure');
});

test('wrap cache releases large parent string storage after insertion', () => {
  assertParentStorageReleased('wrap-text.js', 'wrap');
});

test('invalid budgets cannot disable eviction', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => new TextCache(value), RangeError);
    assert.throws(() => new TextCache(1, value), RangeError);
  }
});
