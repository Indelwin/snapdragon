import type { SdTodoItem, SdTodoUpdateInput } from './todo-types.js';

export const TODO_PATCH_KEYS = ['content', 'status', 'priority', 'notes', 'source'] as const;

export function applyTodoField(
  item: SdTodoItem,
  patch: SdTodoUpdateInput,
  key: (typeof TODO_PATCH_KEYS)[number],
): void {
  const value = patch[key];
  if (value === undefined) return;
  Object.assign(item, { [key]: key === 'content' ? value.trim() : value });
}
