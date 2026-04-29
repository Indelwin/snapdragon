import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveSplashImagePath } from '../src/tui/splash-art.ts';

// 4×4 solid pink PNG, hand-crafted so the test doesn't need any
// image-generation library at runtime.
const PINK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP439AARwzEcQBGsR/xEHHjoQAAAABJRU5ErkJggg==';
const PINK_PNG = Buffer.from(PINK_PNG_BASE64, 'base64');

test('resolveSplashImagePath prefers the active profile over the sd root', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-splash-'));
  try {
    const profileDir = join(workspace, 'profile');
    const sdRoot = join(workspace, 'sd');
    await mkdir(profileDir, { recursive: true });
    await mkdir(sdRoot, { recursive: true });
    await writeFile(join(sdRoot, 'splash.png'), PINK_PNG);
    await writeFile(join(profileDir, 'splash.png'), PINK_PNG);

    const profileHit = resolveSplashImagePath({
      profile: { name: 'p', dir: profileDir, configPath: '', valid: true },
      sdRoot,
    });
    assert.equal(profileHit, join(profileDir, 'splash.png'));

    const sdRootHit = resolveSplashImagePath({ sdRoot });
    assert.equal(sdRootHit, join(sdRoot, 'splash.png'));

    const miss = resolveSplashImagePath({ sdRoot: join(workspace, 'nope') });
    assert.equal(miss, undefined);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('resolveSplashImagePath returns undefined when neither candidate exists', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-splash-empty-'));
  try {
    assert.equal(resolveSplashImagePath({ sdRoot: workspace }), undefined);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('resolveSplashImagePath ignores a profile with no dir', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-splash-no-profile-dir-'));
  try {
    await writeFile(join(workspace, 'splash.png'), PINK_PNG);
    const hit = resolveSplashImagePath({
      profile: { name: 'p', dir: '', configPath: '', valid: true },
      sdRoot: workspace,
    });
    assert.equal(hit, join(workspace, 'splash.png'));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
