import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shellToolset } from '../src/toolsets/shell.js';

function runShell(opts: {
  command: string;
  timeout_ms?: number;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
}) {
  const ts = shellToolset({
    cwd: process.cwd(),
    defaultTimeoutMs: opts.defaultTimeoutMs ?? 30_000,
    maxTimeoutMs: 120_000,
    maxOutputBytes: opts.maxOutputBytes,
  });
  const tool = ts.tools.find((t) => t.name === 'run_shell');
  assert.ok(tool, 'run_shell tool exists');
  return tool.run(
    { command: opts.command, ...(opts.timeout_ms != null ? { timeout_ms: opts.timeout_ms } : {}) },
    { signal: undefined as unknown as AbortSignal },
  );
}

test('run_shell returns stdout for a quick command', async () => {
  const result = await runShell({ command: 'echo hello' });
  assert.match(String(result.content), /hello/);
  assert.equal(result.isError, false);
});

test('run_shell times out and reports it (simple sleep)', async () => {
  const t0 = Date.now();
  const result = await runShell({ command: 'sleep 5', timeout_ms: 300 });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 3_000, `should finish well before sleep ends, got ${elapsed}ms`);
  assert.equal(result.isError, true);
  assert.match(String(result.content), /timeout after 300ms/);
  assert.equal((result.data as { timed_out?: boolean })?.timed_out, true);
});

test('run_shell unblocks even when a backgrounded grandchild keeps stdout open', async () => {
  // Reproduces the run_shell-blocks-forever bug: sh exits but a backgrounded
  // child inherits stdout and keeps the pipe open. With `detached: true` and
  // a process-group SIGTERM, the whole group dies on timeout and `close`
  // fires. Without the fix, this test hangs until the outer node-test timer.
  const t0 = Date.now();
  // Spawn a backgrounded sleeper that holds stdout, then exit sh's foreground
  // process. The pipe stays open via the backgrounded sleeper's stdout fd.
  const result = await runShell({
    command: 'sh -c "sleep 30 & echo started; exit 0"',
    timeout_ms: 800,
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 5_000, `should not hang on leaked grandchild, took ${elapsed}ms`);
  // It either timed out (group kill) or closed cleanly because the group
  // got reaped — either way it must not hang. Output should at least show
  // the "started" line we printed before backgrounding.
  assert.match(String(result.content), /started/);
});

test('run_shell keeps a bounded tail for noisy commands', async () => {
  const result = await runShell({
    command:
      "printf 'first\\n'; i=0; while [ $i -lt 200 ]; do printf x; i=$((i + 1)); done; printf '\\nlast\\n'",
    maxOutputBytes: 32,
  });
  const content = String(result.content);
  assert.doesNotMatch(content, /first/);
  assert.match(content, /last/);
  assert.match(content, /truncated/);
});
