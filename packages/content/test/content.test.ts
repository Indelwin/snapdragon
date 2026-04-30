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

test('memory auto-capture extracts a normalized note from "remember"', () => {
  const decision = memoryShouldAutoCapture({
    userInput: 'remember to run pack dry before release',
  });
  assert.equal(decision.capture, true);
  assert.equal(decision.trigger, 'remember');
  assert.equal(decision.extracted, 'run pack dry before release');
});

test('memory auto-capture handles "from now on" / always / never / dont / prefer-over', () => {
  const cases: Array<{ input: string; trigger: string; extracted: string }> = [
    {
      input: 'From now on, branch names use snapdragon/ prefix.',
      trigger: 'from-now-on',
      extracted: 'branch names use snapdragon/ prefix',
    },
    {
      input: 'Always run the tests before pushing.',
      trigger: 'imperative-always',
      extracted: 'Always run the tests before pushing',
    },
    { input: 'Never commit dist/.', trigger: 'imperative-never', extracted: 'Never commit dist/' },
    {
      input: "Don't push without a green CI.",
      trigger: 'imperative-dont',
      extracted: "Don't push without a green CI",
    },
    {
      input: 'I prefer pnpm over npm in this monorepo.',
      trigger: 'prefer-over',
      extracted: 'Prefer pnpm over npm in this monorepo',
    },
  ];
  for (const { input, trigger, extracted } of cases) {
    const decision = memoryShouldAutoCapture({ userInput: input });
    assert.equal(decision.capture, true, `should capture: ${input}`);
    assert.equal(decision.trigger, trigger);
    assert.equal(decision.extracted, extracted);
  }
});

test('memory auto-capture rejects the noisy patterns the old substring matcher fired on', () => {
  // These exact phrasings polluted MEMORY.md under the v1 implementation
  // (substring match on 'we should' / 'i want' / etc). They MUST NOT
  // capture under the anchored-rule implementation.
  const inputs = [
    'Honestly, Phase 0 covers most of what we want. The core agent WASM should obviously not be included.',
    'Ok that seems to work! I noticed a few things. I want you to read this manifesto.',
    'Ok, I just got this error, after your bash tool failed to return: 400 invalid_request_error',
    'we should always do this',
    "I don't think we need that",
    'never mind, that was wrong',
    'i prefer it actually',
  ];
  for (const input of inputs) {
    const decision = memoryShouldAutoCapture({ userInput: input });
    assert.equal(decision.capture, false, `must not capture: ${input}`);
  }
});

test('memory auto-capture rejects long inputs and multi-paragraph discussion', () => {
  const longInput = `remember ${'word '.repeat(200)}`;
  assert.equal(memoryShouldAutoCapture({ userInput: longInput }).capture, false);

  const multiPara =
    'remember to run tests\n\nAlso, separately, here is some discussion that should not be part of the capture.';
  assert.equal(memoryShouldAutoCapture({ userInput: multiPara }).capture, false);
});

test('memory auto-capture honours policy.enabled=false and custom triggers', () => {
  assert.equal(
    memoryShouldAutoCapture({ userInput: 'remember to do X' }, { enabled: false }).reason,
    'disabled',
  );
  // Restrict triggers to just 'remember' — 'always X' should now NOT fire.
  assert.equal(
    memoryShouldAutoCapture({ userInput: 'Always run tests' }, { triggers: ['remember'] }).capture,
    false,
  );
  // But the explicit 'remember' rule still fires.
  assert.equal(
    memoryShouldAutoCapture({ userInput: 'remember to run tests' }, { triggers: ['remember'] })
      .capture,
    true,
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
