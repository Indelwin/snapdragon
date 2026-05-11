import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSdRuntime } from '../src/runtime.ts';
import { initialSdUiEvents } from '../src/tui/ui.ts';

test('TUI startup events surface a resumed session summary', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tui-resume-summary-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const first = await createSdRuntime({ cwd: workspace, configPath, sessionId: 'alpha' });
    first.session?.appendMessage({ role: 'user', content: 'hello' });
    first.session?.appendMessage({ role: 'assistant', content: 'hi' });

    const resumed = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
      resume: true,
    });
    const events = initialSdUiEvents(resumed);
    const transcript = events.find(
      (event) => event.type === 'ui.component.register' && event.descriptor.id === 'sd.chat',
    );

    assert.ok(transcript && 'state' in transcript);
    assert.match(JSON.stringify(transcript.state), /Resumed alpha: .*2 messages/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeMockConfig(workspace: string): Promise<string> {
  const configPath = join(workspace, 'sd.yaml');
  await mkdir(workspace, { recursive: true });
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
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}
