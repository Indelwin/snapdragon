import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { parseArgs } from '../src/args.ts';
import { createSdRuntime } from '../src/runtime.ts';
import type { SdTuiCommand } from '../src/tui/commands.ts';
import { SdTuiApp } from '../src/tui/index.tsx';
import { runInlineShellCommand } from '../src/tui/inline-shell.ts';
import { runSlashLine, submitLine } from '../src/tui/input-commands.ts';
import {
  buildPromptCompletion,
  completePromptDraft,
  type PromptCompletionState,
} from '../src/tui/input-completion.ts';
import { handleGlobalInput, handlePromptInput } from '../src/tui/input-keymap.ts';
import { chatEntries } from '../src/tui/state-readers.ts';
import {
  transcriptRows,
  visibleTranscriptRows,
  wrapTranscriptRows,
} from '../src/tui/transcript-window.ts';
import { SD_UI_IDS, SdUiController } from '../src/tui/ui.ts';

test('SdUiController maps agent streams and tool events into UI ECS state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);

    controller.acceptAgentEvent({ type: 'run_start', runId: 'run_1' });
    controller.acceptAgentEvent({
      type: 'message',
      message: { role: 'user', content: 'hello' },
    });
    controller.acceptAgentEvent({
      type: 'provider_event',
      event: { kind: 'text', run_id: 'run_1', provider: 'mock', delta: 'hi' },
    });
    controller.acceptAgentEvent({
      type: 'tool_start',
      call: { id: 'tool_1', name: 'read_file', args_json: '{}' },
    });
    controller.acceptAgentEvent({
      type: 'tool_end',
      call: { id: 'tool_1', name: 'read_file', args_json: '{}' },
      content: 'done',
      isError: false,
    });
    controller.acceptAgentEvent({
      type: 'run_end',
      runId: 'run_1',
      response: { content: 'hi' },
    });

    const chat = controller.world.componentState(SD_UI_IDS.chat);
    const tools = controller.world.componentState(SD_UI_IDS.toolPanel);
    assert.match(JSON.stringify(chat), /hello/);
    assert.match(JSON.stringify(chat), /hi/);
    assert.match(JSON.stringify(tools), /read_file/);
    assert.equal(controller.isRunning, false);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('SdUiController keeps tool-loop assistant output to one visible response', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-tool-loop-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);

    controller.acceptAgentEvent({ type: 'run_start', runId: 'run_1' });
    controller.acceptAgentEvent({ type: 'message', message: { role: 'user', content: 'test' } });
    controller.acceptAgentEvent({
      type: 'provider_event',
      event: { kind: 'started', run_id: 'run_1', provider: 'mock' },
    });
    controller.acceptAgentEvent({
      type: 'provider_event',
      event: { kind: 'text', run_id: 'run_1', provider: 'mock', delta: 'checking' },
    });
    controller.acceptAgentEvent({
      type: 'message',
      message: {
        role: 'assistant',
        content: 'checking',
        tool_calls: [{ id: 'tool_1', name: 'read_file', args_json: '{}' }],
      },
    });
    controller.acceptAgentEvent({
      type: 'tool_end',
      call: { id: 'tool_1', name: 'read_file', args_json: '{}' },
      content: 'line one\nline two\nline three\nline four',
      isError: false,
    });
    controller.acceptAgentEvent({
      type: 'provider_event',
      event: { kind: 'started', run_id: 'run_1', provider: 'mock' },
    });
    controller.acceptAgentEvent({
      type: 'provider_event',
      event: { kind: 'text', run_id: 'run_1', provider: 'mock', delta: 'final answer' },
    });
    controller.acceptAgentEvent({
      type: 'message',
      message: { role: 'assistant', content: 'final answer' },
    });
    controller.acceptAgentEvent({
      type: 'run_end',
      runId: 'run_1',
      response: { content: 'final answer' },
    });

    const chat = controller.world.componentState(SD_UI_IDS.chat).entries as Array<{
      role: string;
      content: string;
      streaming?: boolean;
    }>;
    const assistantEntries = chat.filter((entry) => entry.role === 'assistant');
    const toolEntries = chat.filter((entry) => entry.role === 'tool');
    assert.equal(assistantEntries.length, 1);
    assert.equal(assistantEntries[0]?.content, 'final answer');
    assert.equal(assistantEntries[0]?.streaming, false);
    assert.equal(toolEntries.length, 1);

    const entries = chatEntries(controller.world.componentState(SD_UI_IDS.chat));
    const keys = transcriptRows(entries).map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(transcriptRows(entries).some((row) => row.markdown));

    const events = JSON.stringify(controller.world.componentState(SD_UI_IDS.eventLog));
    assert.match(events, /line four/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('transcript wrapping is calculated before bottom viewport selection', () => {
  const rows = wrapTranscriptRows(
    transcriptRows([
      {
        id: 'a',
        role: 'assistant',
        content: 'first line with enough text to wrap before the final short line\nbottom',
      },
    ]),
    24,
  );
  const visible = visibleTranscriptRows(rows, 2, 0);

  assert.equal(visible.at(-1)?.text, 'bottom');
});

test('SdTuiApp renders the initial ECS shell and later tool activity', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-render-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);
    const app = render(
      React.createElement(SdTuiApp, {
        runtime,
        controller,
      }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.match(app.lastFrame() ?? '', /SNAPDRAGON/);
    assert.match(app.lastFrame() ?? '', /ctrl-p for commands/);
    controller.acceptAgentEvent({
      type: 'tool_start',
      call: { id: 'tool_1', name: 'read_file', args_json: '{}' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(app.lastFrame() ?? '', /read_file/);
    app.unmount();
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('public sd package exports a lazy TUI runner', async () => {
  const sd = await import('../src/index.ts');
  assert.equal(typeof sd.runTui, 'function');
});

test('prompt completion shows slash commands and tab completes them', () => {
  const commands = testCommands();
  const completion = buildPromptCompletion('/', commands, []);
  assert.equal(completion?.mode, 'slash');
  assert.deepEqual(
    completion?.suggestions.map((suggestion) => suggestion.label),
    ['/help', '/clear', '/quit'],
  );

  const next = completePromptDraft('/c', commands, [], undefined);
  assert.equal(next?.draft, '/clear');
  assert.equal(next?.completion.selectedIndex, 0);
  assert.equal(next?.completion.suggestions[0]?.label, '/clear');
});

test('TUI slash command errors render instead of escaping', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-command-error-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);

    await runSlashLine({
      line: '/provider missing',
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
    });

    const chat = controller.world.componentState(SD_UI_IDS.chat);
    assert.match(JSON.stringify(chat), /Provider 'missing' is not configured/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('TUI provider and model commands open selectable prompt options', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-selectors-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);
    let draft = '';
    let completion: PromptCompletionState | undefined;

    await runSlashLine({
      line: '/providers',
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
      openSelection: (nextDraft, nextCompletion) => {
        draft = nextDraft;
        completion = nextCompletion;
      },
    });

    assert.equal(draft, '/provider ');
    assert.equal(completion?.mode, 'provider');
    assert.ok(completion?.suggestions.some((suggestion) => suggestion.label === 'mock'));

    await runSlashLine({
      line: '/models',
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
      openSelection: (nextDraft, nextCompletion) => {
        draft = nextDraft;
        completion = nextCompletion;
      },
    });

    assert.equal(draft, '/model ');
    assert.equal(completion?.mode, 'model');
    assert.equal(completion?.suggestions[0]?.label, 'mock');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('TUI session and profile commands open selectable prompt options', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-session-selectors-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);
    let draft = '';
    let completion: PromptCompletionState | undefined;

    await runSlashLine({
      line: '/sessions',
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
      openSelection: (nextDraft, nextCompletion) => {
        draft = nextDraft;
        completion = nextCompletion;
      },
    });

    assert.equal(draft, '/resume ');
    assert.equal(completion?.mode, 'session');
    assert.equal(completion?.suggestions[0]?.label, runtime.session?.sessionId);

    await runSlashLine({
      line: '/profiles',
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
      openSelection: (nextDraft, nextCompletion) => {
        draft = nextDraft;
        completion = nextCompletion;
      },
    });

    assert.equal(draft, '/profile ');
    assert.equal(completion?.mode, 'profile');
    assert.equal(completion?.suggestions[0]?.label, 'none');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('TUI skills command opens selectable skill options', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-skill-selectors-'));
  try {
    await writeSkill(join(workspace, 'skills'), 'code-review', 'code-review', 'Review code');
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);
    let draft = '';
    let completion: PromptCompletionState | undefined;

    await runSlashLine({
      line: '/skills',
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
      openSelection: (nextDraft, nextCompletion) => {
        draft = nextDraft;
        completion = nextCompletion;
      },
    });

    assert.equal(draft, '/skill ');
    assert.equal(completion?.mode, 'skill');
    assert.equal(completion?.suggestions[0]?.label, 'code-review');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('TUI runtime transitions are blocked while a run is active', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-active-guard-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);
    controller.acceptAgentEvent({ type: 'run_start', runId: 'run_1' });

    await runSlashLine({
      line: '/new-session beta',
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
    });

    const chat = controller.world.componentState(SD_UI_IDS.chat);
    assert.match(JSON.stringify(chat), /A run is already active/);
    assert.notEqual(runtime.session?.sessionId, 'beta');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('TUI rebinds agent events after session resume before the next prompt', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-resume-bind-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);
    const originalSessionId = runtime.session?.sessionId;
    assert.ok(originalSessionId);
    controller.bindRuntimeAgent();

    await runSlashLine({
      line: '/new-session beta',
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
    });
    await runSlashLine({
      line: `/resume ${originalSessionId}`,
      runtime,
      controller,
      exit: () => undefined,
      attachmentsRef: { current: [] },
      setAttachments: () => undefined,
      setPalette: () => undefined,
    });

    await submitLine({
      line: 'after resume',
      runtime,
      controller,
      attachmentsRef: { current: [] },
      historyRef: { current: [] },
      commandsRef: { current: [] },
      setAttachments: () => undefined,
      runSlashCommand: async () => undefined,
    });

    const chat = controller.world.componentState(SD_UI_IDS.chat);
    assert.match(JSON.stringify(chat), /after resume/);
    assert.match(JSON.stringify(chat), /mock response/);
    assert.equal(controller.isRunning, false);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('prompt up/down navigates selection buffers before history', async () => {
  const commands = testCommands();
  const catalog = {
    providers: [
      { id: 'anthropic', kind: 'anthropic', active: true },
      { id: 'openai-codex', kind: 'openai-codex' },
    ],
  };
  const draftRef = { current: '/provider ' };
  const completionRef = {
    current: buildPromptCompletion('/provider ', commands, [], catalog),
  };
  const historyIndexRef = { current: -1 };
  let submitted = '';
  const setDraft = (draft: string, completion?: PromptCompletionState) => {
    draftRef.current = draft;
    completionRef.current = completion ?? buildPromptCompletion(draft, commands, [], catalog);
  };
  const args = {
    draftRef,
    historyRef: { current: ['/help'] },
    historyIndexRef,
    historyDraftRef: { current: '' },
    commandsRef: { current: commands },
    shellCommandsRef: { current: [] },
    completionRef,
    completionCatalog: catalog,
    setDraft,
    submit: async (line: string) => {
      submitted = line;
    },
  };

  handlePromptInput('', { downArrow: true }, args);

  assert.equal(completionRef.current?.selectedIndex, 1);
  assert.equal(historyIndexRef.current, -1);

  handlePromptInput('', { return: true }, args);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(submitted, '/provider openai-codex');
});

test('chat page keys update transcript scroll state before prompt handling', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-scroll-'));
  try {
    const runtime = await createMockRuntime(workspace);
    const controller = new SdUiController(runtime);
    const commonArgs = {
      controller,
      exit: () => undefined,
      setDraft: () => undefined,
      setPalette: () => undefined,
      paletteRef: { current: { open: false, query: '', selectedIndex: 0 } },
      historyIndexRef: { current: -1 },
    };

    assert.equal(handleGlobalInput('', { pageUp: true }, commonArgs), true);
    assert.equal(controller.world.componentState(SD_UI_IDS.chat).scrollOffset, 10);

    assert.equal(handleGlobalInput('', { pageDown: true }, commonArgs), true);
    assert.equal(controller.world.componentState(SD_UI_IDS.chat).scrollOffset, 0);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('prompt completion supports inline shell command names', () => {
  const completion = buildPromptCompletion('!g', testCommands(), ['git', 'grep', 'npm']);
  assert.equal(completion?.mode, 'shell');
  assert.deepEqual(
    completion?.suggestions.map((suggestion) => suggestion.label),
    ['git', 'grep'],
  );
  const first = completePromptDraft('!', testCommands(), ['git', 'grep'], undefined);
  assert.equal(first?.draft, '!git');
  assert.equal(first?.completion.selectedIndex, 0);
  const second = completePromptDraft(
    first?.draft ?? '',
    testCommands(),
    ['git', 'grep'],
    first?.completion,
  );
  assert.equal(second?.draft, '!grep');
  assert.equal(second?.completion.selectedIndex, 1);
});

test('prompt completion supports provider and model arguments', () => {
  const catalog = {
    providers: [
      { id: 'anthropic', kind: 'anthropic', active: true },
      { id: 'openai-codex', kind: 'openai-codex' },
    ],
    models: [{ id: 'claude-opus-4-7', active: true }, { id: 'claude-sonnet-4-5' }],
  };

  const activeProvider = buildPromptCompletion('/provider', testCommands(), [], catalog);
  assert.equal(activeProvider?.mode, 'provider');
  assert.equal(activeProvider?.suggestions[activeProvider.selectedIndex]?.label, 'anthropic');

  const providers = buildPromptCompletion('/provider o', testCommands(), [], catalog);
  assert.equal(providers?.mode, 'provider');
  assert.deepEqual(
    providers?.suggestions.map((suggestion) => suggestion.label),
    ['openai-codex'],
  );
  assert.equal(
    completePromptDraft('/provider o', testCommands(), [], providers, catalog)?.draft,
    '/provider openai-codex',
  );

  const models = buildPromptCompletion('/model claude-s', testCommands(), [], catalog);
  assert.equal(models?.mode, 'model');
  assert.deepEqual(
    models?.suggestions.map((suggestion) => suggestion.label),
    ['claude-sonnet-4-5'],
  );
  assert.equal(
    completePromptDraft('/model claude-s', testCommands(), [], models, catalog)?.draft,
    '/model claude-sonnet-4-5',
  );
});

test('prompt completion supports session and profile arguments', () => {
  const catalog = {
    sessions: [
      { id: 'alpha', active: true, updatedAt: 1 },
      { id: 'beta', updatedAt: 2 },
    ],
    profiles: [
      { id: 'none', active: true, description: 'active', valid: true },
      { id: 'daily', description: 'Daily driver', valid: true },
    ],
  };

  const session = buildPromptCompletion('/resume b', testCommands(), [], catalog);
  assert.equal(session?.mode, 'session');
  assert.equal(session?.suggestions[0]?.label, 'beta');
  assert.equal(
    completePromptDraft('/resume b', testCommands(), [], session, catalog)?.draft,
    '/resume beta',
  );

  const profile = buildPromptCompletion('/profile d', testCommands(), [], catalog);
  assert.equal(profile?.mode, 'profile');
  assert.equal(profile?.suggestions[0]?.label, 'daily');
  assert.equal(
    completePromptDraft('/profile d', testCommands(), [], profile, catalog)?.draft,
    '/profile daily',
  );
});

test('prompt completion supports skill arguments', () => {
  const catalog = {
    skills: [{ id: 'code-review', command: '/code-review', description: 'Review code' }],
  };
  const skill = buildPromptCompletion('/skill code', testCommands(), [], catalog);
  assert.equal(skill?.mode, 'skill');
  assert.equal(skill?.suggestions[0]?.label, 'code-review');
  assert.equal(
    completePromptDraft('/skill code', testCommands(), [], skill, catalog)?.draft,
    '/skill code-review',
  );
});

test('inline shell command returns stdout and error status', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-shell-'));
  try {
    const result = await runInlineShellCommand('printf shell-ok', {
      cwd: workspace,
      timeoutMs: 5_000,
    });
    assert.equal(result.isError, false);
    assert.equal(result.content, 'shell-ok');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function createMockRuntime(workspace: string) {
  const configPath = join(workspace, 'sd.yaml');
  await writeFile(
    configPath,
    [
      'version: 1',
      'default_provider: mock',
      'providers:',
      '  mock:',
      '    kind: mock',
      '    model: mock',
      'sessions:',
      `  root: "${join(workspace, 'sessions').replace(/"/g, '\\"')}"`,
      'skills:',
      `  root: "${join(workspace, 'skills').replace(/"/g, '\\"')}"`,
      '  builtins: false',
      '',
    ].join('\n'),
    'utf8',
  );
  return createSdRuntime({
    ...parseArgs(['--config', configPath, '--cwd', workspace]),
    profileRoot: join(workspace, 'profiles'),
  });
}

async function writeSkill(
  root: string,
  id: string,
  name: string,
  description: string,
): Promise<void> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', 'Body.', ''].join('\n'),
    'utf8',
  );
}

function testCommands(): SdTuiCommand[] {
  return [
    { name: '/help', description: 'show help', run: () => undefined },
    { name: '/clear', description: 'clear chat', run: () => undefined },
    { name: '/quit', description: 'quit', run: () => undefined },
  ];
}
