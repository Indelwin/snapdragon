import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  type ClipboardRunner,
  clipboardSupported,
  parseAppleScriptHex,
  pasteImageAttachment,
  readClipboardImage,
  readClipboardText,
  unsupportedPlatformMessage,
} from '../src/clipboard.ts';

// Minimal valid PNG bytes (signature + IHDR + IDAT + IEND for a 1x1 image).
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makeRunner(map: Record<string, { stdout: string; failed?: boolean }>): ClipboardRunner {
  return async (command) => {
    const result = map[command];
    if (!result) return { stdout: '', failed: true };
    return result;
  };
}

test('clipboardSupported is true on darwin and false elsewhere', () => {
  assert.equal(clipboardSupported({ platform: 'darwin' }), true);
  assert.equal(clipboardSupported({ platform: 'linux' }), false);
  assert.equal(clipboardSupported({ platform: 'win32' }), false);
});

test('readClipboardImage throws a clear error on unsupported platforms', async () => {
  await assert.rejects(readClipboardImage({ platform: 'linux' }), /not yet implemented on linux/);
  assert.match(unsupportedPlatformMessage({ platform: 'win32' }), /win32/);
});

test('readClipboardImage decodes AppleScript hex into raw bytes', async () => {
  const hex = PNG_BYTES.toString('hex').toUpperCase();
  const runner = makeRunner({
    osascript: { stdout: `«data PNGf${hex}»` },
  });
  const image = await readClipboardImage({ platform: 'darwin', runner });
  assert.ok(image, 'expected an image');
  assert.equal(image.mediaType, 'image/png');
  assert.deepEqual(image.data, PNG_BYTES);
});

test('readClipboardImage returns null when the clipboard has no image', async () => {
  const runner = makeRunner({ osascript: { stdout: '' } });
  const image = await readClipboardImage({ platform: 'darwin', runner });
  assert.equal(image, null);
});

test('readClipboardImage returns null when osascript fails', async () => {
  const runner = makeRunner({ osascript: { stdout: '', failed: true } });
  const image = await readClipboardImage({ platform: 'darwin', runner });
  assert.equal(image, null);
});

test('readClipboardText returns the pbpaste output', async () => {
  const runner = makeRunner({ pbpaste: { stdout: 'hello world' } });
  const text = await readClipboardText({ platform: 'darwin', runner });
  assert.deepEqual(text, { text: 'hello world' });
});

test('readClipboardText returns null when the clipboard is empty', async () => {
  const runner = makeRunner({ pbpaste: { stdout: '' } });
  const text = await readClipboardText({ platform: 'darwin', runner });
  assert.equal(text, null);
});

test('parseAppleScriptHex tolerates a bare hex blob and rejects garbage', () => {
  assert.deepEqual(parseAppleScriptHex('48656c6c6f'), Buffer.from('Hello'));
  assert.equal(parseAppleScriptHex(''), null);
  assert.equal(parseAppleScriptHex('not-hex-data'), null);
  // Odd-length hex should be rejected — half-bytes are never legitimate.
  assert.equal(parseAppleScriptHex('abc'), null);
});

test('pasteImageAttachment writes a PNG and returns a base64 attachment', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-paste-'));
  try {
    const hex = PNG_BYTES.toString('hex').toUpperCase();
    const runner = makeRunner({ osascript: { stdout: `«data PNGf${hex}»` } });
    const attachment = await pasteImageAttachment({
      platform: 'darwin',
      runner,
      attachmentsDir: workspace,
      cwd: workspace,
    });
    assert.ok(attachment, 'expected an attachment');
    assert.equal(attachment.block.type, 'image');
    assert.equal(attachment.block.source.type, 'base64');
    if (attachment.block.source.type === 'base64') {
      assert.equal(attachment.block.source.media_type, 'image/png');
      assert.equal(attachment.block.source.data, PNG_BYTES.toString('base64'));
    }
    const files = await readdir(workspace);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^clipboard-[0-9a-f]{12}\.png$/);
    const written = await readFile(join(workspace, files[0]!));
    assert.deepEqual(written, PNG_BYTES);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('pasteImageAttachment returns null when the clipboard has no image', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-paste-'));
  try {
    const runner = makeRunner({ osascript: { stdout: '' } });
    const attachment = await pasteImageAttachment({
      platform: 'darwin',
      runner,
      attachmentsDir: workspace,
      cwd: workspace,
    });
    assert.equal(attachment, null);
    const files = await readdir(workspace);
    assert.equal(files.length, 0);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('pasteImageAttachment is content-addressed: the same image hashes to one file', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-paste-'));
  try {
    const hex = PNG_BYTES.toString('hex').toUpperCase();
    const runner = makeRunner({ osascript: { stdout: `«data PNGf${hex}»` } });
    const first = await pasteImageAttachment({
      platform: 'darwin',
      runner,
      attachmentsDir: workspace,
      cwd: workspace,
    });
    const second = await pasteImageAttachment({
      platform: 'darwin',
      runner,
      attachmentsDir: workspace,
      cwd: workspace,
    });
    assert.ok(first && second);
    assert.equal(first.label, second.label);
    const files = await readdir(workspace);
    assert.equal(files.length, 1);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
