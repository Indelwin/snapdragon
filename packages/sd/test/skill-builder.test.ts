import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Message } from '@snapdragon-ai/host';
import type { SdBackgroundChat } from '../src/background.ts';
import { defaultSdConfig, type SdConfig } from '../src/config.ts';
import { SdMemoryStore } from '../src/memory.ts';
import {
  acceptSkillDraft,
  listSkillDrafts,
  readSkillDraft,
  rejectSkillDraft,
  runSdSkillBuilderOnce,
  skillBuilderService,
} from '../src/skill-builder.ts';

interface Fixture {
  workspace: string;
  config: SdConfig;
  memory: SdMemoryStore;
  memoryPath: string;
  sessionsRoot: string;
  skillsRoot: string;
  cleanup: () => Promise<void>;
}

async function makeFixture(
  builderConfigOverrides?: Partial<NonNullable<SdConfig['skills']>['builder']>,
): Promise<Fixture> {
  const workspace = await mkdtemp(join(tmpdir(), 'sd-skill-builder-'));
  const memoryRoot = join(workspace, 'memory');
  const sessionsRoot = join(workspace, 'sessions');
  const skillsRoot = join(workspace, 'skills');
  await mkdir(memoryRoot, { recursive: true });
  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(skillsRoot, { recursive: true });
  const memoryPath = join(memoryRoot, 'MEMORY.md');
  const config: SdConfig = {
    ...defaultSdConfig(),
    sessions: { enabled: true, root: sessionsRoot },
    memory: {
      enabled: true,
      authoring: true,
      root: memoryRoot,
      file: 'MEMORY.md',
    },
    skills: {
      root: skillsRoot,
      builder: {
        enabled: true,
        // Lower thresholds for tests so the synthetic fixture tickles the
        // detector without needing 50 sessions.
        min_pattern_count: 2,
        min_distinct_sessions: 2,
        ...builderConfigOverrides,
      },
    },
  };
  const memory = new SdMemoryStore({ path: memoryPath });
  return {
    workspace,
    config,
    memory,
    memoryPath,
    sessionsRoot,
    skillsRoot,
    cleanup: () => rm(workspace, { force: true, recursive: true }),
  };
}

interface SyntheticTurn {
  role: 'user' | 'assistant';
  text?: string;
  toolCalls?: string[];
  created_at: number;
}

async function writeSession(
  sessionsRoot: string,
  sessionId: string,
  turns: SyntheticTurn[],
): Promise<void> {
  const path = join(sessionsRoot, `${sessionId}.jsonl`);
  const lines: string[] = [
    JSON.stringify({
      type: 'session_open',
      session_id: sessionId,
      created_at: turns[0]?.created_at ?? Date.now() / 1000,
      schema_version: 1,
    }),
  ];
  turns.forEach((turn, index) => {
    const record: Record<string, unknown> = {
      type: 'message',
      store_id: index + 1,
      role: turn.role,
      content: turn.text ?? '',
      created_at: turn.created_at,
    };
    if (turn.toolCalls) {
      record.tool_calls = turn.toolCalls.map((name, callIndex) => ({
        id: `tc-${sessionId}-${index}-${callIndex}`,
        name,
        args_json: '{}',
      }));
    }
    lines.push(JSON.stringify(record));
  });
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
}

test('skill-builder detects an n-gram repeated across distinct sessions', async () => {
  const fx = await makeFixture();
  try {
    // Two sessions both run the same `read_file -> repl_eval` n-gram twice.
    // Total count = 4, distinct sessions = 2 — well above the test thresholds.
    await writeSession(fx.sessionsRoot, 'sess-a', [
      { role: 'user', text: 'do the thing', created_at: 100 },
      {
        role: 'assistant',
        toolCalls: ['read_file', 'repl_eval'],
        created_at: 101,
      },
      { role: 'user', text: 'and again', created_at: 102 },
      {
        role: 'assistant',
        toolCalls: ['read_file', 'repl_eval'],
        created_at: 103,
      },
    ]);
    await writeSession(fx.sessionsRoot, 'sess-b', [
      { role: 'user', text: 'same thing', created_at: 200 },
      {
        role: 'assistant',
        toolCalls: ['read_file', 'repl_eval', 'write_file'],
        created_at: 201,
      },
    ]);

    const result = await runSdSkillBuilderOnce({ config: fx.config, memory: fx.memory });

    assert.equal(result.scanned_sessions, 2);
    assert.ok(result.candidates_emitted >= 1, 'should emit at least one candidate');
    assert.deepEqual(result.errors, []);

    const mem = await readFile(fx.memoryPath, 'utf8');
    assert.match(mem, /Skill candidate: read_file→repl_eval/);
    assert.match(mem, /tags:[^\n]*skill-candidate/);
    assert.match(mem, /tags:[^\n]*tentative/);
    assert.match(mem, /Recurring tool sequence detected/);
  } finally {
    await fx.cleanup();
  }
});

test('skill-builder rejects single-session and same-tool n-grams', async () => {
  const fx = await makeFixture();
  try {
    // ONE session repeats `read_file → write_file` 5×. distinct_sessions = 1
    // → below threshold (default 2) → should NOT emit.
    await writeSession(fx.sessionsRoot, 'lonely-sess', [
      { role: 'assistant', toolCalls: ['read_file', 'write_file'], created_at: 1 },
      { role: 'assistant', toolCalls: ['read_file', 'write_file'], created_at: 2 },
      { role: 'assistant', toolCalls: ['read_file', 'write_file'], created_at: 3 },
      { role: 'assistant', toolCalls: ['read_file', 'write_file'], created_at: 4 },
    ]);
    // ANOTHER session has only `read_file → read_file` repeated (uninteresting).
    await writeSession(fx.sessionsRoot, 'identical-sess', [
      { role: 'assistant', toolCalls: ['read_file', 'read_file'], created_at: 10 },
      { role: 'assistant', toolCalls: ['read_file', 'read_file'], created_at: 11 },
    ]);

    const result = await runSdSkillBuilderOnce({ config: fx.config, memory: fx.memory });

    assert.equal(result.candidates_emitted, 0, 'no cross-session interesting n-gram');
  } finally {
    await fx.cleanup();
  }
});

test('skill-builder is idempotent — re-emit-blocked across runs', async () => {
  const fx = await makeFixture();
  try {
    await writeSession(fx.sessionsRoot, 'sess-1', [
      { role: 'assistant', toolCalls: ['git_status', 'git_diff'], created_at: 1 },
      { role: 'assistant', toolCalls: ['git_status', 'git_diff'], created_at: 2 },
    ]);
    await writeSession(fx.sessionsRoot, 'sess-2', [
      { role: 'assistant', toolCalls: ['git_status', 'git_diff'], created_at: 10 },
    ]);

    const a = await runSdSkillBuilderOnce({ config: fx.config, memory: fx.memory });
    const b = await runSdSkillBuilderOnce({ config: fx.config, memory: fx.memory });

    assert.ok(a.candidates_emitted >= 1, 'first run emits');
    assert.equal(b.candidates_emitted, 0, 'second run is dedupe-blocked');
    const mem = await readFile(fx.memoryPath, 'utf8');
    const matches = mem.match(/Skill candidate: git_status→git_diff/g) ?? [];
    assert.equal(matches.length, 1, 'memory contains one entry, not two');
  } finally {
    await fx.cleanup();
  }
});

test('skill-builder respects skills.builder.enabled = false', async () => {
  const fx = await makeFixture({ enabled: false });
  try {
    await writeSession(fx.sessionsRoot, 'sess', [
      { role: 'assistant', toolCalls: ['a', 'b'], created_at: 1 },
      { role: 'assistant', toolCalls: ['a', 'b'], created_at: 2 },
    ]);
    const result = await runSdSkillBuilderOnce({ config: fx.config, memory: fx.memory });
    assert.equal(result.scanned_sessions, 0);
    assert.equal(result.candidates_emitted, 0);
  } finally {
    await fx.cleanup();
  }
});

test('skill-builder drafts a SKILL.md when chat is provided', async () => {
  const fx = await makeFixture();
  try {
    await writeSession(fx.sessionsRoot, 'sess-x', [
      { role: 'user', text: 'find usage of foo and update it', created_at: 100 },
      { role: 'assistant', toolCalls: ['grep', 'edit_file'], created_at: 101 },
      { role: 'user', text: 'now find bar and update it too', created_at: 102 },
      { role: 'assistant', toolCalls: ['grep', 'edit_file'], created_at: 103 },
    ]);
    await writeSession(fx.sessionsRoot, 'sess-y', [
      { role: 'user', text: 'find baz references', created_at: 200 },
      { role: 'assistant', toolCalls: ['grep', 'edit_file'], created_at: 201 },
    ]);

    const calls: Message[][] = [];
    const chat: SdBackgroundChat = async (messages) => {
      calls.push(messages);
      return {
        content: [
          '---',
          'name: search-and-replace',
          'description: Find symbol references via grep and update them with edit_file.',
          'tags: [refactor, grep, workflow]',
          '---',
          '',
          'Use this when the user asks to find and update references to a symbol.',
          '',
          '1. grep for the symbol across the workspace.',
          '2. For each hit, edit_file to apply the rename.',
          '3. Verify with a follow-up grep.',
        ].join('\n'),
      };
    };

    const result = await runSdSkillBuilderOnce({
      config: fx.config,
      memory: fx.memory,
      chat,
    });

    assert.equal(result.drafts_written, 1, 'one draft written');
    assert.ok(result.candidates_emitted >= 1);
    assert.equal(calls.length, 1, 'chat called exactly once');
    // Prompt should mention the actual user inputs from the session.
    const userMessage = calls[0]?.find((m) => m.role === 'user');
    assert.match(String(userMessage?.content), /grep → edit_file/);
    assert.match(String(userMessage?.content), /find usage of foo/);

    const drafts = listSkillDrafts(fx.config, undefined);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.id, 'search-and-replace');
    const skillContent = await readFile(drafts[0]!.skillPath, 'utf8');
    assert.match(skillContent, /name: search-and-replace/);
    assert.match(skillContent, /Find symbol references/);

    // Memory note should be tagged 'skill-draft-ready' (not 'tentative') and
    // include the draft path so the agent can find it.
    const mem = await readFile(fx.memoryPath, 'utf8');
    assert.match(mem, /Skill draft ready: grep→edit_file/);
    assert.match(mem, /tags:[^\n]*skill-draft-ready/);
    assert.match(mem, /\.drafts\/search-and-replace/);
  } finally {
    await fx.cleanup();
  }
});

test('skill-builder respects max_drafts_per_pass', async () => {
  const fx = await makeFixture({ max_drafts_per_pass: 0 });
  try {
    await writeSession(fx.sessionsRoot, 'sess-1', [
      { role: 'assistant', toolCalls: ['a', 'b'], created_at: 1 },
      { role: 'assistant', toolCalls: ['a', 'b'], created_at: 2 },
    ]);
    await writeSession(fx.sessionsRoot, 'sess-2', [
      { role: 'assistant', toolCalls: ['a', 'b'], created_at: 10 },
    ]);
    let chatCalls = 0;
    const chat: SdBackgroundChat = async () => {
      chatCalls += 1;
      return { content: 'never reached' };
    };
    const result = await runSdSkillBuilderOnce({ config: fx.config, memory: fx.memory, chat });
    assert.equal(chatCalls, 0, 'chat never called when max_drafts_per_pass=0');
    assert.equal(result.drafts_written, 0);
    // But the candidate is still surfaced as a tentative memory note.
    assert.ok(result.candidates_emitted >= 1);
  } finally {
    await fx.cleanup();
  }
});

test('drafts directory is hidden from skill discovery and accept moves it out', async () => {
  const fx = await makeFixture();
  try {
    await writeSession(fx.sessionsRoot, 'sess-1', [
      { role: 'assistant', toolCalls: ['read_file', 'repl_eval'], created_at: 1 },
      { role: 'assistant', toolCalls: ['read_file', 'repl_eval'], created_at: 2 },
    ]);
    await writeSession(fx.sessionsRoot, 'sess-2', [
      { role: 'assistant', toolCalls: ['read_file', 'repl_eval'], created_at: 10 },
    ]);
    const chat: SdBackgroundChat = async () => ({
      content: [
        '---',
        'name: read-eval',
        'description: Read a file then evaluate it.',
        'tags: [io]',
        '---',
        '',
        'Use this when reading then computing on a file.',
        '',
        '1. read_file the input.',
        '2. repl_eval to compute on it.',
      ].join('\n'),
    });

    await runSdSkillBuilderOnce({ config: fx.config, memory: fx.memory, chat });
    const drafts = listSkillDrafts(fx.config, undefined);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.id, 'read-eval');

    // readSkillDraft round-trips
    const read = readSkillDraft(fx.config, undefined, 'read-eval');
    assert.ok(read);
    assert.match(read.content, /name: read-eval/);

    // accept moves the directory out of .drafts/
    const accepted = acceptSkillDraft(fx.config, undefined, 'read-eval');
    assert.ok('dir' in accepted, 'accept succeeds');
    assert.match(accepted.dir, /skills\/read-eval$/);
    // Drafts list now empty.
    assert.equal(listSkillDrafts(fx.config, undefined).length, 0);

    // reject on a non-existent id is a clean error.
    const rejected = rejectSkillDraft(fx.config, undefined, 'no-such-draft');
    assert.ok('error' in rejected);
  } finally {
    await fx.cleanup();
  }
});

test('skill-builder skips drafting when chat returns "SKIP"', async () => {
  const fx = await makeFixture();
  try {
    await writeSession(fx.sessionsRoot, 'sess-1', [
      { role: 'assistant', toolCalls: ['ls', 'cat'], created_at: 1 },
      { role: 'assistant', toolCalls: ['ls', 'cat'], created_at: 2 },
    ]);
    await writeSession(fx.sessionsRoot, 'sess-2', [
      { role: 'assistant', toolCalls: ['ls', 'cat'], created_at: 10 },
    ]);
    const chat: SdBackgroundChat = async () => ({ content: 'SKIP' });
    const result = await runSdSkillBuilderOnce({ config: fx.config, memory: fx.memory, chat });
    // 'SKIP' has no frontmatter, so draftCandidate throws → recorded as
    // an error, no draft written, but the candidate IS surfaced as a
    // plain skill-candidate memory note.
    assert.equal(result.drafts_written, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0] ?? '', /no frontmatter/);
    assert.equal(listSkillDrafts(fx.config, undefined).length, 0);
  } finally {
    await fx.cleanup();
  }
});

test('skillBuilderService is enabled by default and disables when explicitly off', () => {
  const service = skillBuilderService();
  const baseCtx = {
    config: { ...defaultSdConfig(), memory: { enabled: true, authoring: true } } as SdConfig,
    memory: {} as SdMemoryStore,
    profile: undefined,
    now: Date.now,
    log: () => undefined,
  };
  // Default-on: no `skills.builder` block at all → service.enabled returns true.
  assert.equal(service.enabled?.(baseCtx), true, 'default config: enabled');

  // Explicit opt-out flips it off.
  const offCtx = {
    ...baseCtx,
    config: {
      ...baseCtx.config,
      skills: { builder: { enabled: false } },
    } as SdConfig,
  };
  assert.equal(service.enabled?.(offCtx), false, 'enabled=false: disabled');

  // Memory disabled → service can't append → disabled.
  const noMemCtx = {
    ...baseCtx,
    config: { ...baseCtx.config, memory: { enabled: false } } as SdConfig,
  };
  assert.equal(service.enabled?.(noMemCtx), false, 'memory disabled: disabled');
});
