import { spawn } from 'node:child_process';
import type { JsonObject } from '@snapdragon-ai/core';
import { objectArg, optionalNumberArg, stringArg } from '../safety.js';
import type { Tool, ToolResult, Toolset } from '../types.js';

export interface ShellToolsetOptions {
  cwd: string;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
}

export function shellToolset(options: ShellToolsetOptions): Toolset {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  const maxTimeoutMs = options.maxTimeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64_000;
  return {
    name: 'shell',
    title: 'Shell tools',
    description: 'Run shell commands inside the workspace.',
    tools: [runShellTool(options.cwd, defaultTimeoutMs, maxTimeoutMs, maxOutputBytes)],
  };
}

function runShellTool(
  cwd: string,
  defaultTimeoutMs: number,
  maxTimeoutMs: number,
  maxOutputBytes: number,
): Tool {
  return {
    name: 'run_shell',
    toolset: 'shell',
    description: 'Run a shell command in the workspace.',
    parameters: schema(
      { command: { type: 'string' }, timeout_ms: { type: 'number', default: defaultTimeoutMs } },
      ['command'],
    ),
    async run(args, context): Promise<ToolResult> {
      const input = objectArg(args);
      const timeoutMs = Math.min(
        optionalNumberArg(input, 'timeout_ms') ?? defaultTimeoutMs,
        maxTimeoutMs,
      );
      return runCommand(
        stringArg(input, 'command'),
        cwd,
        timeoutMs,
        maxOutputBytes,
        context.signal,
      );
    },
  };
}

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    // `detached: true` makes the spawned `sh` a process-group leader so we can
    // signal the entire pipeline (sh + npm + node --test + leaked TUI children
    // + …) by sending the signal to `-pid`. Without this, `child.kill()` only
    // reaps `sh`; its grandchildren keep running, keep the inherited stdout/
    // stderr pipes open, and `close` never fires — the Promise hangs forever
    // even though the timeout fired. That was the run_shell-blocks-forever bug.
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const append = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const next = text.length >= maxOutputBytes ? text.slice(-maxOutputBytes) : output + text;
      truncated ||= output.length + text.length > maxOutputBytes;
      output = next.length > maxOutputBytes ? next.slice(-maxOutputBytes) : next;
    };
    const killGroup = (sig: NodeJS.Signals) => {
      if (child.pid == null) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        // Group already gone (ESRCH) or no permission — fall back to direct.
        try {
          child.kill(sig);
        } catch {
          /* ignore */
        }
      }
    };
    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      // Escalate if the group ignores SIGTERM (e.g. a stuck native binary).
      killTimer = setTimeout(() => killGroup('SIGKILL'), 2_000);
    }, timeoutMs);
    const abort = () => {
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), 2_000);
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      resolve({
        content: shellOutputContent(output, code, { timedOut, timeoutMs, truncated }),
        isError: shellResultIsError(code, timedOut),
        data: { exit_code: code, timed_out: timedOut },
      });
    };
    child.on('close', finish);
    child.on('error', () => finish(null));
  });
}

interface ShellOutputState {
  timedOut: boolean;
  timeoutMs: number;
  truncated: boolean;
}

function shellOutputContent(output: string, code: number | null, state: ShellOutputState): string {
  return `${output}${shellOutputSuffix(state)}` || `(exit ${code ?? 'unknown'}, no output)`;
}

function shellOutputSuffix(state: ShellOutputState): string {
  if (state.timedOut) return `\n[timeout after ${state.timeoutMs}ms]`;
  if (state.truncated) return '\n[truncated]';
  return '';
}

function shellResultIsError(code: number | null, timedOut: boolean): boolean {
  return timedOut || (code ?? 0) !== 0;
}

function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}
