import type {
  MemoryManageRequest,
  MemoryProvider,
  MemorySearchResult,
} from '@snapdragon-ai/content';
import type { JsonObject, JsonValue } from '@snapdragon-ai/core';
import { objectArg, optionalNumberArg, stringArg } from '../safety.js';
import type { Tool, ToolResult, Toolset } from '../types.js';

export interface MemoryToolsetOptions {
  provider: MemoryProvider;
  authoring?: boolean;
}

export function memoryToolset(options: MemoryToolsetOptions): Toolset {
  return {
    name: 'memory',
    title: 'Memory tools',
    description: 'Read, search, and update the active memory provider.',
    tools: [
      memoryReadTool(options.provider),
      memorySearchTool(options.provider),
      memoryAppendTool(options.provider, options.authoring ?? false),
      memoryManageTool(options.provider, options.authoring ?? false),
    ],
  };
}

function memoryReadTool(provider: MemoryProvider): Tool {
  return {
    name: 'memory_read',
    toolset: 'memory',
    description: 'Read the active memory provider. Use this before changing durable memory.',
    parameters: schema(
      {
        id: { type: 'string' },
        limit: { type: 'number', default: 20 },
      },
      [],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArgOrEmpty(args);
      const result = await provider.read({
        id: typeof input.id === 'string' ? input.id : undefined,
        limit: boundedLimit(optionalNumberArg(input, 'limit') ?? 20),
      });
      return {
        content: result.entries.map(formatEntry).join('\n\n') || '(memory empty)',
        data: jsonData(result),
      };
    },
  };
}

function memorySearchTool(provider: MemoryProvider): Tool {
  return {
    name: 'memory_search',
    toolset: 'memory',
    description: 'Search durable memory for relevant preferences, project notes, and workflows.',
    parameters: schema(
      {
        query: { type: 'string' },
        limit: { type: 'number', default: 10 },
      },
      ['query'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const results = await provider.search({
        query: stringArg(input, 'query'),
        limit: boundedLimit(optionalNumberArg(input, 'limit') ?? 10),
      });
      return {
        content: results.map(formatSearchResult).join('\n\n') || '(no memory matches)',
        data: jsonData({ results }),
      };
    },
  };
}

function memoryAppendTool(provider: MemoryProvider, authoring: boolean): Tool {
  return {
    name: 'memory_append',
    toolset: 'memory',
    description:
      'Append a durable memory note when the user gives a stable preference or workflow.',
    parameters: schema(
      {
        content: { type: 'string' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        source: { type: 'string' },
      },
      ['content'],
    ),
    async run(args): Promise<ToolResult> {
      if (!authoring) return { content: 'Memory authoring is disabled.', isError: true };
      const input = objectArg(args);
      const result = await provider.append({
        content: stringArg(input, 'content'),
        title: typeof input.title === 'string' ? input.title : undefined,
        tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
        source: typeof input.source === 'string' ? input.source : 'tool',
      });
      return {
        content: result.success
          ? (result.message ?? 'Memory updated.')
          : (result.error ?? 'Memory update failed.'),
        isError: !result.success,
        data: jsonData(result),
      };
    },
  };
}

function memoryManageTool(provider: MemoryProvider, authoring: boolean): Tool {
  return {
    name: 'memory_manage',
    toolset: 'memory',
    description: 'Patch, replace, delete, or append memory through the active memory provider.',
    parameters: schema(
      {
        action: { type: 'string', enum: ['append', 'patch', 'delete', 'replace'] },
        id: { type: 'string' },
        content: { type: 'string' },
        title: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        source: { type: 'string' },
      },
      ['action'],
    ),
    async run(args): Promise<ToolResult> {
      if (!authoring) return { content: 'Memory authoring is disabled.', isError: true };
      if (!provider.manage) {
        return { content: 'This memory provider does not support management.', isError: true };
      }
      const result = await provider.manage(objectArg(args) as unknown as MemoryManageRequest);
      return {
        content: result.success
          ? (result.message ?? 'Memory updated.')
          : (result.error ?? 'Memory update failed.'),
        isError: !result.success,
        data: jsonData(result),
      };
    },
  };
}

function formatEntry(entry: { id: string; title?: string; content: string }): string {
  const title = entry.title ? `${entry.id} - ${entry.title}` : entry.id;
  return [`## ${title}`, entry.content].join('\n');
}

function formatSearchResult(entry: MemorySearchResult): string {
  const score = entry.score === undefined ? '' : ` score=${entry.score}`;
  return `${formatEntry(entry)}${score}`;
}

function jsonData(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function objectArgOrEmpty(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return objectArg(value);
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(Math.floor(limit), 100));
}

function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}
