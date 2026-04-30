import assert from 'node:assert/strict';
import test from 'node:test';
import { packageName } from '../lib/imports.mjs';

test('package name is extracted from package source files', () => {
  assert.equal(packageName('/repo/packages/host/src/index.ts'), 'host');
  assert.equal(packageName('/repo/packages/sd/test/index.ts'), 'sd');
});
