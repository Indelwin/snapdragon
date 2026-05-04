import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkillSimilarityQuery } from '../src/skill-builder-similarity.ts';
import type { SdSkillPattern } from '../src/skill-builder-types.ts';

function pattern(overrides: Partial<SdSkillPattern> = {}): SdSkillPattern {
  return {
    id: 'run_shell→edit_file',
    ngram: ['run_shell', 'edit_file'],
    totalCount: 5,
    distinctSessions: 3,
    exampleSessions: ['s1', 's2', 's3'],
    ...overrides,
  };
}

test('buildSkillSimilarityQuery prefers the first example prompt', () => {
  const q = buildSkillSimilarityQuery(
    pattern({
      examples: [{ sessionId: 's1', precedingPrompt: 'fix the timestamp display bug', calls: [] }],
    }),
  );
  assert.match(q, /fix the timestamp display bug/);
  // n-gram tools still appended for backstop recall
  assert.match(q, /run_shell/);
  assert.match(q, /edit_file/);
});

test('buildSkillSimilarityQuery skips empty preceding prompts', () => {
  const q = buildSkillSimilarityQuery(
    pattern({
      examples: [
        { sessionId: 's1', precedingPrompt: '   ', calls: [] },
        { sessionId: 's2', precedingPrompt: 'rebase onto main', calls: [] },
      ],
    }),
  );
  assert.match(q, /rebase onto main/);
});

test('buildSkillSimilarityQuery falls back to ngram-only when no examples', () => {
  const q = buildSkillSimilarityQuery(pattern({ examples: undefined }));
  assert.equal(q, 'run_shell edit_file');
});

test('buildSkillSimilarityQuery truncates very long preceding prompts', () => {
  const long = 'x'.repeat(1000);
  const q = buildSkillSimilarityQuery(
    pattern({ examples: [{ sessionId: 's1', precedingPrompt: long, calls: [] }] }),
    { maxPromptChars: 50 },
  );
  // 50 x's, then a space, then the two tool names
  const xs = q.match(/x+/)?.[0] ?? '';
  assert.equal(xs.length, 50);
});
