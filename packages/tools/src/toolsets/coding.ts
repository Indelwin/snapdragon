import { spawn } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { JsonObject } from '@snapdragon/core';
import { objectArg, optionalNumberArg, resolveInside, stringArg } from '../safety.js';
import type { Tool, ToolResult, Toolset } from '../types.js';

export interface CodingToolsetOptions {
  cwd: string;
  maxReadBytes?: number;
  maxOutputBytes?: number;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}

export function codingToolset(options: CodingToolsetOptions): Toolset {
  const maxReadBytes = options.maxReadBytes ?? 256_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64_000;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  const maxTimeoutMs = options.maxTimeoutMs ?? 120_000;

  return {
    name: 'coding',
    title: 'Coding tools',
    description: 'Read, write, edit, list files, and run shell commands inside the workspace.',
    tools: [
      readFileTool(options.cwd, maxReadBytes),
      writeFileTool(options.cwd),
      editFileTool(options.cwd),
      listFilesTool(options.cwd),
      runShellTool(options.cwd, defaultTimeoutMs, maxTimeoutMs, maxOutputBytes),
    ],
  };
}

function readFileTool(cwd: string, maxReadBytes: number): Tool {
  return {
    name: 'read_file',
    toolset: 'coding',
    description: 'Read a UTF-8 text file under the workspace.',
    parameters: schema(
      {
        path: { type: 'string', description: 'Path relative to the workspace.' },
      },
      ['path'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const file = resolveInside(cwd, stringArg(input, 'path'));
      const content = await readFile(file, 'utf8');
      const truncated = content.length > maxReadBytes;
      return {
        content: truncated ? `${content.slice(0, maxReadBytes)}\n[truncated]` : content,
        data: { path: relative(cwd, file), bytes: Buffer.byteLength(content), truncated },
      };
    },
  };
}

function writeFileTool(cwd: string): Tool {
  return {
    name: 'write_file',
    toolset: 'coding',
    description:
      'Write a UTF-8 text file under the workspace, creating parent directories as needed.',
    parameters: schema(
      {
        path: { type: 'string', description: 'Path relative to the workspace.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      ['path', 'content'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const file = resolveInside(cwd, stringArg(input, 'path'));
      await import('node:fs/promises').then((fs) => fs.mkdir(dirname(file), { recursive: true }));
      const content = stringArg(input, 'content');
      await writeFile(file, content, 'utf8');
      return { content: `Wrote ${relative(cwd, file)}`, data: { path: relative(cwd, file) } };
    },
  };
}

function editFileTool(cwd: string): Tool {
  return {
    name: 'edit_file',
    toolset: 'coding',
    description: 'Replace text in a UTF-8 file under the workspace.',
    parameters: schema(
      {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
        replace_all: { type: 'boolean', default: false },
      },
      ['path', 'old_text', 'new_text'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const file = resolveInside(cwd, stringArg(input, 'path'));
      const oldText = stringArg(input, 'old_text');
      const newText = stringArg(input, 'new_text');
      const replaceAll = input.replace_all === true;
      const content = await readFile(file, 'utf8');
      if (!content.includes(oldText)) {
        return { content: `Text not found in ${relative(cwd, file)}`, isError: true };
      }
      const next = replaceAll
        ? content.split(oldText).join(newText)
        : content.replace(oldText, newText);
      await writeFile(file, next, 'utf8');
      return {
        content: `Edited ${relative(cwd, file)}`,
        data: { path: relative(cwd, file), replace_all: replaceAll },
      };
    },
  };
}

function listFilesTool(cwd: string): Tool {
  return {
    name: 'list_files',
    toolset: 'coding',
    description: 'List files under a workspace directory.',
    parameters: schema(
      {
        path: { type: 'string', default: '.' },
        max_entries: { type: 'number', default: 200 },
      },
      [],
    ),
    async run(args): Promise<ToolResult> {
      const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
      const dir = resolveInside(cwd, typeof input.path === 'string' ? input.path : '.');
      const maxEntries = Math.max(
        1,
        Math.min(optionalNumberArg(input, 'max_entries') ?? 200, 1000),
      );
      const entries = await walk(dir, cwd, maxEntries);
      return { content: entries.join('\n') || '(empty)', data: { entries } };
    },
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
    toolset: 'coding',
    description: 'Run a shell command in the workspace.',
    parameters: schema(
      {
        command: { type: 'string' },
        timeout_ms: { type: 'number', default: defaultTimeoutMs },
      },
      ['command'],
    ),
    async run(args, context): Promise<ToolResult> {
      const input = objectArg(args);
      const command = stringArg(input, 'command');
      const timeoutMs = Math.min(
        optionalNumberArg(input, 'timeout_ms') ?? defaultTimeoutMs,
        maxTimeoutMs,
      );
      return runCommand(command, cwd, timeoutMs, maxOutputBytes, context.signal);
    },
  };
}

async function walk(dir: string, cwd: string, maxEntries: number): Promise<string[]> {
  const out: string[] = [];
  async function visit(current: string): Promise<void> {
    if (out.length >= maxEntries) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= maxEntries) return;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target')
        continue;
      const full = join(current, entry.name);
      out.push(entry.isDirectory() ? `${relative(cwd, full)}/` : relative(cwd, full));
      if (entry.isDirectory()) await visit(full);
    }
  }
  const info = await stat(dir);
  if (info.isDirectory()) await visit(dir);
  else out.push(relative(cwd, dir));
  return out;
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
    const abort = () => {
      child.kill('SIGTERM');
    };
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
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}
