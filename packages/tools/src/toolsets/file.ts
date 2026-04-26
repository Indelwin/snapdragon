import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { JsonObject } from '@snapdragon-ai/core';
import { objectArg, optionalNumberArg, resolveInside, stringArg } from '../safety.js';
import type { Tool, ToolResult, Toolset } from '../types.js';

export interface FileToolsetOptions {
  cwd: string;
  maxReadBytes?: number;
}

export function fileToolset(options: FileToolsetOptions): Toolset {
  const maxReadBytes = options.maxReadBytes ?? 256_000;
  return {
    name: 'file',
    title: 'File tools',
    description: 'Read, write, edit, and list files inside the workspace.',
    tools: [
      readFileTool(options.cwd, maxReadBytes),
      writeFileTool(options.cwd),
      editFileTool(options.cwd),
      listFilesTool(options.cwd),
    ],
  };
}

function readFileTool(cwd: string, maxReadBytes: number): Tool {
  return {
    name: 'read_file',
    toolset: 'file',
    description: 'Read a UTF-8 text file under the workspace.',
    parameters: schema(
      { path: { type: 'string', description: 'Path relative to the workspace.' } },
      ['path'],
    ),
    async run(args): Promise<ToolResult> {
      const file = resolveInside(cwd, stringArg(objectArg(args), 'path'));
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
    toolset: 'file',
    description: 'Write a UTF-8 text file under the workspace, creating parent directories.',
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
      await writeFile(file, stringArg(input, 'content'), 'utf8');
      return { content: `Wrote ${relative(cwd, file)}`, data: { path: relative(cwd, file) } };
    },
  };
}

function editFileTool(cwd: string): Tool {
  return {
    name: 'edit_file',
    toolset: 'file',
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
      const content = await readFile(file, 'utf8');
      if (!content.includes(oldText))
        return { content: `Text not found in ${relative(cwd, file)}`, isError: true };
      const next =
        input.replace_all === true
          ? content.split(oldText).join(stringArg(input, 'new_text'))
          : content.replace(oldText, stringArg(input, 'new_text'));
      await writeFile(file, next, 'utf8');
      return { content: `Edited ${relative(cwd, file)}`, data: { path: relative(cwd, file) } };
    },
  };
}

function listFilesTool(cwd: string): Tool {
  return {
    name: 'list_files',
    toolset: 'file',
    description: 'List files under a workspace directory.',
    parameters: schema(
      { path: { type: 'string', default: '.' }, max_entries: { type: 'number', default: 200 } },
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

async function walk(dir: string, cwd: string, maxEntries: number): Promise<string[]> {
  const out: string[] = [];
  async function visit(current: string): Promise<void> {
    if (out.length >= maxEntries) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (out.length >= maxEntries) return;
      if (['node_modules', '.git', 'target'].includes(entry.name)) continue;
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

function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}
