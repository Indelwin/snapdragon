import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { probePiRpcRuntime, runPiRpcAgentJob } from '../src/pi-rpc.js';
import { startPiRpcSession } from '../src/pi-rpc-process.js';
import {
  MAX_PI_RESULT_CONTENT_BYTES,
  MAX_PI_RESULT_EVENT_BYTES,
  MAX_PI_RESULT_EVENTS,
  MAX_PI_RESULT_STATE_BYTES,
} from '../src/pi-rpc-run-state.js';
import { createPiRpcSession } from '../src/pi-rpc-session.js';
import type { PiRpcSession } from '../src/pi-rpc-types.js';

test('Pi applies stream backpressure while a slow observer handles an event flood', async () => {
  const fixture = await writeReliabilityFixture();
  let observed = 0;
  let active = 0;
  let maxActive = 0;
  try {
    const result = await runPiRpcAgentJob(
      { prompt: 'flood', targetRuntimeId: 'pi' },
      {
        command: process.execPath,
        args: [fixture.path],
        timeoutMs: 5_000,
        async onEvent() {
          observed++;
          active++;
          maxActive = Math.max(maxActive, active);
          await delay(2);
          active--;
        },
      },
    );
    assert.equal(observed, 102);
    assert.equal(result.metrics.event_count, 102);
    assert.equal(maxActive, 1);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('Pi rejects an oversized unterminated JSONL frame explicitly', async () => {
  const fixture = await writeReliabilityFixture();
  try {
    await assert.rejects(
      runPiRpcAgentJob(
        { prompt: 'oversize', targetRuntimeId: 'pi' },
        {
          command: process.execPath,
          args: [fixture.path],
          maxLineBytes: 1_024,
          shutdownGraceMs: 20,
          timeoutMs: 2_000,
        },
      ),
      /JSONL line exceeded maxLineBytes=1024/,
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('Pi contains observer throws without failing or creating rejected listener tasks', async () => {
  const fixture = await writeReliabilityFixture();
  try {
    const result = await runPiRpcAgentJob(
      { prompt: 'listener-throw', targetRuntimeId: 'pi' },
      {
        command: process.execPath,
        args: [fixture.path],
        timeoutMs: 2_000,
        onEvent() {
          throw new Error('observer failed');
        },
      },
    );
    assert.equal(result.content, 'listener survived');
    assert.equal(result.metrics.observer_error_count, 3);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('Pi stop releases a blocked observer, joins the pump, and avoids unhandled rejection', async () => {
  const fixture = await writeReliabilityFixture();
  const unhandled: unknown[] = [];
  let observerSignal: AbortSignal | undefined;
  const captureUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', captureUnhandled);
  const startedAt = Date.now();
  try {
    await assert.rejects(
      runPiRpcAgentJob(
        { prompt: 'blocked', targetRuntimeId: 'pi' },
        {
          command: process.execPath,
          args: [fixture.path],
          shutdownGraceMs: 20,
          timeoutMs: 100,
          onEvent(_event, context) {
            observerSignal = context.signal;
            return new Promise<void>(() => {});
          },
        },
      ),
      /timed out after 100ms/,
    );
    await delay(25);
    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal(observerSignal?.aborted, true);
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', captureUnhandled);
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('Pi stop settles requests still pending in the owned session', async () => {
  const fixture = await writeReliabilityFixture();
  const child = spawn(process.execPath, [fixture.path], { stdio: 'pipe' });
  const session = createPiRpcSession(child, { shutdownGraceMs: 20 });
  try {
    const pending = session.send({ type: 'never_respond' });
    await delay(10);
    await session.stop();
    const response = await pending;
    assert.equal(response.success, false);
    assert.equal(response.error, 'Pi RPC session stopped');
  } finally {
    await session.stop();
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('Pi bounds result projections and links the complete canonical trace artifact', async () => {
  const fixture = await writeReliabilityFixture();
  const outputArtifact = join(fixture.root, 'result.json');
  try {
    const result = await runPiRpcAgentJob(
      { prompt: 'retention', targetRuntimeId: 'pi', outputArtifact },
      { command: process.execPath, args: [fixture.path], timeoutMs: 10_000 },
    );

    assert.ok(Buffer.byteLength(result.content) <= MAX_PI_RESULT_CONTENT_BYTES);
    assert.ok(result.events.length <= MAX_PI_RESULT_EVENTS);
    assert.ok(result.metrics.retained_event_bytes <= MAX_PI_RESULT_EVENT_BYTES);
    assert.ok(result.metrics.retained_state_bytes <= MAX_PI_RESULT_STATE_BYTES);
    assert.equal(result.truncation?.content.truncated, true);
    assert.equal(result.truncation?.events.truncated, true);
    assert.ok((result.truncation?.events.projectedCount ?? 0) >= 2);
    assert.equal(result.truncation?.state.truncated, true);
    assert.equal((result.state as { type?: string }).type, 'pi_rpc_json_preview');
    const retainedAgentEnd = result.events.find((event) => event.type === 'agent_end');
    assert.equal((retainedAgentEnd?.payload as { type?: string }).type, 'pi_rpc_json_preview');
    assert.equal(result.outputArtifact, outputArtifact);

    const traceArtifact = `${outputArtifact}.trace.jsonl`;
    assert.deepEqual(result.artifacts, { result: outputArtifact, traces: [traceArtifact] });
    const traceLines = (await readFile(traceArtifact, 'utf8')).trimEnd().split('\n');
    assert.equal(traceLines.length, 682);
    const lastLine = traceLines.at(-1);
    assert.ok(lastLine);
    const lastEvent = JSON.parse(lastLine) as {
      payload: { messages: Array<{ content: string }> };
    };
    assert.equal(lastEvent.payload.messages[0]?.content.length, 400 * 1_024);

    const persistedResult = JSON.parse(await readFile(outputArtifact, 'utf8')) as {
      artifacts: { traces: string[] };
      truncation: { state: { truncated: boolean } };
    };
    assert.deepEqual(persistedResult.artifacts.traces, [traceArtifact]);
    assert.equal(persistedResult.truncation.state.truncated, true);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('Pi drains agent_end after clean child exit while observers take 500ms', {
  timeout: 5_000,
}, async () => {
  const seen: string[] = [];
  const result = await runPiRpcAgentJob(
    { prompt: 'exit after completion' },
    {
      command: process.execPath,
      args: [
        '-e',
        rpcFixture(`
      reply(command);
      emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'complete' }] } });
      process.stdout.write(JSON.stringify({ type: 'agent_end', messages: [] }) + '\\n', () => process.exit(0));
    `),
      ],
      timeoutMs: 3_000,
      shutdownGraceMs: 20,
      async onEvent(event) {
        await delay(500);
        seen.push(event.type);
      },
    },
  );
  assert.equal(result.content, 'complete');
  assert.deepEqual(seen, ['message_end', 'agent_end']);
});

test('Pi EOF settles pending and future requests even while the child stays alive', {
  timeout: 3_000,
}, async () => {
  const session = childSession(`process.stdout.end(); setInterval(() => {}, 1_000);`);
  try {
    const response = await session.send({ type: 'request' });
    assert.equal(response.success, false);
    assert.match(response.error ?? '', /EOF/);
    const future = await session.send({ type: 'later' });
    assert.match(future.error ?? '', /EOF/);
  } finally {
    await session.stop();
  }
  assert.ok(session.child.pid);
  assertProcessGone(session.child.pid);
});

test('Pi unanswered requests expire at timeoutMs and a later request can succeed', {
  timeout: 3_000,
}, async () => {
  const session = childSession(`if (command.type === 'reply') reply(command);`, 150);
  try {
    const response = await session.send({ type: 'ignored' });
    assert.equal(response.success, false);
    assert.match(response.error ?? '', /request timed out after 150ms/);
    assert.equal((await session.send({ type: 'reply' })).success, true);
  } finally {
    await session.stop();
  }
});

test('Pi probe deadline covers both requests and reaps the child', { timeout: 3_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-probe-deadline-'));
  const pidPath = join(root, 'pid');
  try {
    await assert.rejects(
      probePiRpcRuntime({
        command: process.execPath,
        args: [
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));\n` +
            rpcFixture(`
        if (command.type === 'get_state') setTimeout(() => reply(command), 150);
      `),
        ],
        timeoutMs: 300,
        shutdownGraceMs: 20,
      }),
      /probe timed out after 300ms/,
    );
    assertProcessGone(Number(await readFile(pidPath, 'utf8')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Pi missing agent_end rejects only after the stream has drained', {
  timeout: 3_000,
}, async () => {
  await assert.rejects(
    runPiRpcAgentJob(
      { prompt: 'incomplete' },
      {
        command: process.execPath,
        args: [
          '-e',
          rpcFixture(`reply(command); process.stdout.end(); setInterval(() => {}, 1_000);`),
        ],
        timeoutMs: 1_000,
        shutdownGraceMs: 20,
      },
    ),
    /EOF/,
  );
});

for (const leaderExits of [false, true]) {
  test(`Pi kills its resistant process group with leaderExits=${leaderExits}`, {
    timeout: 5_000,
    skip: process.platform === 'win32',
  }, async () => {
    const sentinel = childSession('reply(command);');
    const session = childSession(`
      process.on('SIGTERM', () => {});
      const descendant = require('node:child_process').spawn(process.execPath, ['-e',
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.send('ready');"
      ], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      descendant.once('message', () => {
        reply(command, { descendant: descendant.pid });
        ${leaderExits ? 'process.stdout.end(() => process.exit(0));' : 'setInterval(() => {}, 1000);'}
      });
    `);
    let descendantPid: number | undefined;
    try {
      assert.equal((await sentinel.send({ type: 'ready' })).success, true);
      const response = await session.send({ type: 'ready' });
      descendantPid = (response.data as { descendant: number }).descendant;
      if (leaderExits) await delay(100);
      const firstStop = session.stop();
      assert.equal(session.stop(), firstStop);
      await firstStop;
      assert.ok(session.child.pid);
      assertProcessGone(session.child.pid);
      assertProcessGone(descendantPid);
      assert.equal((await sentinel.send({ type: 'still_alive' })).success, true);
      assert.equal((await session.send({ type: 'after_stop' })).success, false);
    } finally {
      await session.stop();
      await sentinel.stop();
      // This PID came from this fixture's own child; never discover or kill
      // unrelated processes by executable name.
      if (descendantPid && processExists(descendantPid)) process.kill(descendantPid, 'SIGKILL');
    }
  });
}

function rpcFixture(body: string): string {
  return `
    const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
    const reply = (command, data) => emit({ type: 'response', id: command.id, success: true, data });
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const command = JSON.parse(line);
      ${body}
    });
  `;
}

function childSession(body: string, timeoutMs = 1_000): PiRpcSession {
  return startPiRpcSession({
    command: process.execPath,
    args: ['-e', rpcFixture(body)],
    timeoutMs,
    shutdownGraceMs: 30,
  });
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw cause;
  }
}

function assertProcessGone(pid: number): void {
  assert.equal(processExists(pid), false, `owned process ${pid} survived stop`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeReliabilityFixture(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), `snapdragon-pi-reliability-${process.pid}-`));
  const path = join(root, 'fixture.mjs');
  await writeFile(
    path,
    `
import { once } from 'node:events';
import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin });
async function emit(value) {
  if (!process.stdout.write(JSON.stringify(value) + '\\n')) await once(process.stdout, 'drain');
}

input.on('line', async (line) => {
  const command = JSON.parse(line);
  if (command.type !== 'prompt') return;
  await emit({ id: command.id, type: 'response', command: 'prompt', success: true });

  if (command.message === 'flood') {
    for (let index = 0; index < 100; index++) await emit({ type: 'trace', index });
    await emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
    await emit({ type: 'agent_end', messages: [] });
    return;
  }
  if (command.message === 'oversize') {
    process.stdout.write('x'.repeat(4_096));
    setInterval(() => {}, 1_000);
    return;
  }
  if (command.message === 'listener-throw') {
    await emit({ type: 'trace', value: 1 });
    await emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'listener survived' }] } });
    await emit({ type: 'agent_end', messages: [] });
    return;
  }
  if (command.message === 'blocked') {
    await emit({ type: 'trace', value: 'blocked observer' });
    setInterval(() => {}, 1_000);
    return;
  }
  if (command.message === 'retention') {
    const detail = 'e'.repeat(4_096);
    for (let index = 0; index < 640; index++) await emit({ type: 'trace', index, detail });
    for (let index = 0; index < 40; index++) {
      await emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'd'.repeat(8_192) },
      });
    }
    await emit({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'c'.repeat(400 * 1_024) }] },
    });
    await emit({ type: 'agent_end', messages: [{ role: 'assistant', content: 's'.repeat(400 * 1_024) }] });
  }
});
`,
    'utf8',
  );
  return { root, path };
}
