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
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > maxOutputBytes) output = output.slice(0, maxOutputBytes);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const suffix = timedOut
        ? `\n[timeout after ${timeoutMs}ms]`
        : output.length >= maxOutputBytes
          ? '\n[truncated]'
          : '';
      resolve({
        content: `${output}${suffix}` || `(exit ${code ?? 'unknown'}, no output)`,
        isError: timedOut || (code ?? 0) !== 0,
        data: { exit_code: code, timed_out: timedOut },
      });
    });
  });
}

function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}
