import type { Tool, ToolResult, Toolset } from '@snapdragon-ai/tools';
import {
  jsonData,
  objectArg,
  objectArgOrEmpty,
  optionalPriority,
  optionalStatus,
  optionalString,
  schema,
  stringArg,
} from './todo-args.js';

export { createSdTodoStore, SdTodoStore } from './todo-store.js';

import type { SdTodoStore } from './todo-store.js';
import { type SdTodoItem, TODO_PRIORITIES, TODO_STATUSES } from './todo-types.js';

export type { SdTodoFile, SdTodoItem, SdTodoPriority, SdTodoStatus } from './todo-types.js';

export function todoToolset(store: SdTodoStore): Toolset {
  return {
    name: 'todo',
    title: 'TODO tools',
    description: 'Maintain a durable task list across turns and sessions.',
    tools: [todoListTool(store), todoAddTool(store), todoUpdateTool(store), todoDeleteTool(store)],
  };
}

function todoListTool(store: SdTodoStore): Tool {
  return {
    name: 'todo_list',
    toolset: 'todo',
    description: 'List durable TODO items. Use this to review ongoing tasks and progress.',
    parameters: schema({ status: { type: 'string', enum: TODO_STATUSES } }, []),
    async run(args): Promise<ToolResult> {
      const status = optionalStatus(objectArgOrEmpty(args).status);
      const todos = store.list(status);
      return { content: formatTodoList(todos), data: jsonData({ todos }) };
    },
  };
}

function todoAddTool(store: SdTodoStore): Tool {
  return {
    name: 'todo_add',
    toolset: 'todo',
    description: 'Add a durable TODO item for work that may span turns or sessions.',
    parameters: schema(
      {
        content: { type: 'string' },
        priority: { type: 'string', enum: TODO_PRIORITIES },
        notes: { type: 'string' },
        source: { type: 'string' },
      },
      ['content'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const item = store.add({
        content: stringArg(input, 'content'),
        priority: optionalPriority(input.priority),
        notes: optionalString(input.notes),
        source: optionalString(input.source) ?? 'tool',
      });
      return { content: `Added TODO ${item.id}: ${item.content}`, data: jsonData({ todo: item }) };
    },
  };
}

function todoUpdateTool(store: SdTodoStore): Tool {
  return {
    name: 'todo_update',
    toolset: 'todo',
    description: 'Update a durable TODO item status, content, priority, or notes.',
    parameters: schema(
      {
        id: { type: 'string' },
        content: { type: 'string' },
        status: { type: 'string', enum: TODO_STATUSES },
        priority: { type: 'string', enum: TODO_PRIORITIES },
        notes: { type: 'string' },
        source: { type: 'string' },
      },
      ['id'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const item = store.update(stringArg(input, 'id'), {
        content: optionalString(input.content),
        status: optionalStatus(input.status),
        priority: optionalPriority(input.priority),
        notes: optionalString(input.notes),
        source: optionalString(input.source),
      });
      if (!item) return { content: `TODO not found: ${String(input.id)}`, isError: true };
      return {
        content: `Updated TODO ${item.id}: [${item.status}] ${item.content}`,
        data: jsonData({ todo: item }),
      };
    },
  };
}

function todoDeleteTool(store: SdTodoStore): Tool {
  return {
    name: 'todo_delete',
    toolset: 'todo',
    description: 'Delete a durable TODO item by id.',
    parameters: schema({ id: { type: 'string' } }, ['id']),
    async run(args): Promise<ToolResult> {
      const id = stringArg(objectArg(args), 'id');
      if (!store.delete(id)) return { content: `TODO not found: ${id}`, isError: true };
      return { content: `Deleted TODO ${id}.`, data: jsonData({ id }) };
    },
  };
}

function formatTodoList(todos: SdTodoItem[]): string {
  if (todos.length === 0) return '(no TODO items)';
  return todos.map(formatTodoItem).join('\n');
}

function formatTodoItem(todo: SdTodoItem): string {
  const priority = todo.priority && todo.priority !== 'normal' ? ` priority=${todo.priority}` : '';
  const notes = todo.notes ? `\n    ${todo.notes}` : '';
  return `${todo.id} [${todo.status}]${priority} ${todo.content}${notes}`;
}
