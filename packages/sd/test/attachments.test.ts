import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  attachmentFromReference,
  contentWithAttachments,
  mediaTypeForPath,
} from '../src/attachments.ts';

test('attachmentFromReference maps image URLs to image URL blocks', async () => {
  const attachment = await attachmentFromReference('https://example.test/image.png');
  assert.deepEqual(attachment.block, {
    type: 'image',
    source: { type: 'url', url: 'https://example.test/image.png' },
    detail: 'auto',
  });
});

test('attachmentFromReference maps local images to base64 image blocks', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-attach-'));
  try {
    await writeFile(join(workspace, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const attachment = await attachmentFromReference('image.png', workspace);
    assert.equal(attachment.block.source.type, 'base64');
    if (attachment.block.source.type === 'base64') {
      assert.equal(attachment.block.source.media_type, 'image/png');
      assert.equal(attachment.block.source.data, 'iVBORw==');
    }
    assert.deepEqual(contentWithAttachments('describe', [attachment]), [
      { type: 'text', text: 'describe' },
      attachment.block,
    ]);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('mediaTypeForPath rejects unsupported local file extensions', () => {
  assert.equal(mediaTypeForPath('a.jpg'), 'image/jpeg');
  assert.throws(() => mediaTypeForPath('notes.txt'), /Unsupported image type/);
});
