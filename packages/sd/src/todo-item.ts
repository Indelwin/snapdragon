import { applyTodoField, TODO_PATCH_KEYS } from './todo-patch.js';
import type { SdTodoAddInput, SdTodoItem, SdTodoUpdateInput } from './todo-types.js';

export type { SdTodoAddInput, SdTodoUpdateInput } from './todo-types.js';

export function newTodoItem(input: SdTodoAddInput, todos: SdTodoItem[], now: number): SdTodoItem {
  return withOptionalTodoFields(
    {
      id: nextTodoId(todos),
      content: input.content.trim(),
      status: input.status ?? 'todo',
      created_at: now,
      updated_at: now,
    },
    input,
  );
}

export function applyTodoPatch(item: SdTodoItem, patch: SdTodoUpdateInput): void {
  for (const key of TODO_PATCH_KEYS) applyTodoField(item, patch, key);
}

function withOptionalTodoFields(item: SdTodoItem, input: SdTodoAddInput): SdTodoItem {
  if (input.priority) item.priority = input.priority;
  if (input.notes) item.notes = input.notes;
  if (input.source) item.source = input.source;
  return item;
}

function nextTodoId(todos: SdTodoItem[]): string {
  return `t${String(highestTodoNumber(todos) + 1).padStart(3, '0')}`;
}

function highestTodoNumber(todos: SdTodoItem[]): number {
  return todos.reduce((highest, todo) => Math.max(highest, todoNumber(todo.id)), 0);
}

function todoNumber(id: string): number {
  return Number(/^t(\d+)$/.exec(id)?.[1] ?? 0);
}
