import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDirectEntrypoint } from '../src/cli.ts';

test('sd binary runs through an npm-style symlink', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-bin-'));
  const binPath = join(workspace, 'sd');

  try {
    const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    await symlink(cliPath, binPath);

    assert.equal(isDirectEntrypoint(pathToFileURL(cliPath).href, binPath), true);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
