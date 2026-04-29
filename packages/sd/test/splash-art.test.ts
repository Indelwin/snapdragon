import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderImageAscii } from '../src/tui/image-renderer.ts';
import { loadSplashImage, resolveSplashImagePath } from '../src/tui/splash-art.ts';

// 4×4 solid pink PNG, hand-crafted so the test doesn't need any
// image-generation library at runtime.
const PINK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP439AARwzEcQBGsR/xEHHjoQAAAABJRU5ErkJggg==';
const PINK_PNG = Buffer.from(PINK_PNG_BASE64, 'base64');

test('renderImageAscii defaults to character-based ASCII art with truecolor', async () => {
  const ascii = await renderImageAscii(PINK_PNG, { width: 16 });
  assert.ok(ascii.length > 0, 'expected non-empty output');
  // ASCII art uses ramp characters (' .:-=+*#%@'), not the U+2584
  // half-block character used by the blocks renderer.
  assert.equal(ascii.includes('\u2584'), false, 'must not emit half-block characters');
  // Truecolor RGB foreground escape — proves we coloured the cells.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI ESC by design
  assert.match(ascii, /\u001b\[38;2;\d+;\d+;\d+m/);
  // Resets at end of every line so a torn render can't leak colour.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI ESC by design
  assert.match(ascii, /\u001b\[0m/);
});

test('renderImageAscii honours style: "blocks" for half-block output', async () => {
  const before = process.env.TERM_PROGRAM;
  // Pretend we're running under iTerm so we can prove the renderer
  // scrubs the env var and forces the ANSI fallback path.
  process.env.TERM_PROGRAM = 'iTerm.app';
  try {
    const ascii = await renderImageAscii(PINK_PNG, { width: 4, height: 4, style: 'blocks' });
    assert.ok(ascii.length > 0, 'expected non-empty output');
    // Must not emit an iTerm OSC payload — those break Ink's layout.
    assert.equal(ascii.includes('\u001b]1337;'), false, 'must not emit iTerm graphics protocol');
    assert.ok(ascii.includes('\u2584'), 'expected ANSI half-block characters');
  } finally {
    if (before === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = before;
  }
});

test('renderImageAscii blocks mode restores graphics-detection env vars', async () => {
  process.env.TERM_PROGRAM = 'iTerm.app';
  process.env.KITTY_WINDOW_ID = '42';
  try {
    await renderImageAscii(PINK_PNG, { width: 4, height: 4, style: 'blocks' });
    assert.equal(process.env.TERM_PROGRAM, 'iTerm.app');
    assert.equal(process.env.KITTY_WINDOW_ID, '42');
  } finally {
    delete process.env.TERM_PROGRAM;
    delete process.env.KITTY_WINDOW_ID;
  }
});

test('resolveSplashImagePath prefers the active profile over the sd root', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-splash-'));
  try {
    const profileDir = join(workspace, 'profile');
    const sdRoot = join(workspace, 'sd');
    await writeFile(join(workspace, 'sd-splash.png'), PINK_PNG);
    await writeFile(join(workspace, 'profile-splash.png'), PINK_PNG);
    const { mkdir, rename } = await import('node:fs/promises');
    await mkdir(profileDir, { recursive: true });
    await mkdir(sdRoot, { recursive: true });
    await rename(join(workspace, 'sd-splash.png'), join(sdRoot, 'splash.png'));
    await rename(join(workspace, 'profile-splash.png'), join(profileDir, 'splash.png'));

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

test('loadSplashImage returns undefined when no splash file is present', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-splash-empty-'));
  try {
    const result = await loadSplashImage({ sdRoot: workspace });
    assert.equal(result, undefined);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('loadSplashImage renders a profile-level splash to ANSI block characters', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-splash-render-'));
  try {
    const profileDir = join(workspace, 'profile');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, 'splash.png'), PINK_PNG);

    const result = await loadSplashImage({
      profile: { name: 'p', dir: profileDir, configPath: '', valid: true },
      sdRoot: workspace,
      render: { width: 4, height: 4 },
    });
    assert.ok(result, 'expected a rendered splash string');
    assert.ok(result.length > 0);
    assert.equal(result.includes('\u001b]1337;'), false);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
