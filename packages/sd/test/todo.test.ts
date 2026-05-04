import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSdRuntime } from '../src/runtime.ts';

test('sd registers durable TODO tools by default', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-todo-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });

    const add = await runtime.agent.registry.invoke('todo_add', {
      content: 'compare Hermes TODO flow',
    });
    assert.match(add.content, /Added TODO t001/);

    const update = await runtime.agent.registry.invoke('todo_update', {
      id: 't001',
      status: 'doing',
      notes: 'Keep state across turns.',
    });
    assert.match(update.content, /\[doing\]/);

    const list = await runtime.agent.registry.invoke('todo_list', {});
    assert.match(list.content, /t001 \[doing\] compare Hermes TODO flow/);
    assert.match(list.content, /Keep state across turns/);

    const file = JSON.parse(await readFile(join(workspace, 'todos.json'), 'utf8')) as {
      todos: Array<{ id: string; status: string; content: string }>;
    };
    assert.deepEqual(
      file.todos.map((todo) => [todo.id, todo.status, todo.content]),
      [['t001', 'doing', 'compare Hermes TODO flow']],
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('profile runtimes keep TODO state profile-local', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-todo-profile-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const profileRoot = join(workspace, 'profiles');
    await mkdir(join(profileRoot, 'uncle-bob'), { recursive: true });
    await writeFile(join(profileRoot, 'uncle-bob', 'profile.yaml'), 'name: uncle-bob\n', 'utf8');
    const runtime = await createSdRuntime({
      cwd: workspace,
      configPath,
      profileRoot,
      profileName: 'uncle-bob',
      provider: 'mock',
      model: 'mock',
      noSession: true,
    });

    await runtime.agent.registry.invoke('todo_add', { content: 'profile scoped task' });
    assert.match(
      await readFile(join(profileRoot, 'uncle-bob', 'todos.json'), 'utf8'),
      /profile scoped task/,
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeMockConfig(workspace: string): Promise<string> {
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
      `  root: "${escapeYaml(join(workspace, 'sessions'))}"`,
      'todo:',
      `  file: "${escapeYaml(join(workspace, 'todos.json'))}"`,
      'skills:',
      `  root: "${escapeYaml(join(workspace, 'skills'))}"`,
      'memory:',
      `  root: "${escapeYaml(join(workspace, 'memory'))}"`,
      'extensions:',
      '  builtins: false',
      '  roots:',
      `    - "${escapeYaml(join(workspace, 'extensions'))}"`,
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"');
}
