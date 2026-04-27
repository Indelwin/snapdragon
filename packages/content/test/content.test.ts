import assert from 'node:assert/strict';
import test from 'node:test';
import {
  memoryShouldAutoCapture,
  parseExtensionManifest,
  parseSkillMarkdown,
  skillCommandMetadata,
  skillCommandSlug,
  skillDescriptorFromMarkdown,
  skillMatchesPlatform,
  validateSkillMarkdown,
} from '../src/index.ts';

const skill = [
  '---',
  'name: code-review',
  'description: Review code carefully',
  'tags: [quality, review]',
  '---',
  '',
  '# Code review',
  '',
  'Run the checks.',
  '',
].join('\n');

test('parses and validates skill markdown frontmatter without leaking body', () => {
  const parsed = validateSkillMarkdown(skill);
  const descriptor = skillDescriptorFromMarkdown({ id: 'software/code-review', raw: skill });

  assert.equal(parsed.frontmatter.name, 'code-review');
  assert.equal(parsed.body.includes('Run the checks.'), true);
  assert.equal(descriptor?.name, 'code-review');
  assert.equal(descriptor?.description, 'Review code carefully');
  assert.deepEqual(descriptor?.tags, ['quality', 'review']);
  assert.equal(JSON.stringify(descriptor).includes('Run the checks.'), false);
});

test('memory auto-capture policy triggers only stable notes', () => {
  assert.equal(memoryShouldAutoCapture({ userInput: 'remember to run pack dry' }).capture, true);
  assert.equal(memoryShouldAutoCapture({ userInput: 'hello there' }).capture, false);
  assert.equal(
    memoryShouldAutoCapture({ userInput: 'remember this' }, { enabled: false }).reason,
    'disabled',
  );
});

test('parses extension manifests with required identity', () => {
  const manifest = parseExtensionManifest('id: local/sandbox\nname: Local Sandbox\n');
  assert.equal(manifest?.id, 'local/sandbox');
  assert.equal(manifest?.name, 'Local Sandbox');
  assert.equal(parseExtensionManifest('name: Missing Id\n'), undefined);
});

test('rejects malformed or incomplete skills', () => {
  assert.equal(parseSkillMarkdown('plain markdown'), undefined);
  assert.throws(
    () => validateSkillMarkdown('---\nname: missing-description\n---\nbody\n'),
    /name and description/,
  );
});

test('normalizes skill commands and reports collisions', () => {
  const command = skillCommandSlug('Code Review++');
  assert.equal(command, '/code-review');
  assert.deepEqual(skillCommandMetadata({ command }, ['/help', '/code-review']), {
    command: '/code-review',
    collides: true,
    reservedBy: '/code-review',
  });
});

test('matches skill platform metadata', () => {
  assert.equal(skillMatchesPlatform({ platforms: ['macos'] }, 'darwin'), true);
  assert.equal(skillMatchesPlatform({ platforms: ['linux'] }, 'darwin'), false);
  assert.equal(skillMatchesPlatform({}, 'darwin'), true);
});
