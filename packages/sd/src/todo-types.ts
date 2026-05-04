export type SdTodoStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'cancelled';

export type SdTodoPriority = 'low' | 'normal' | 'high';

export interface SdTodoItem {
  id: string;
  content: string;
  status: SdTodoStatus;
  created_at: number;
  updated_at: number;
  priority?: SdTodoPriority;
  notes?: string;
  source?: string;
}

export interface SdTodoFile {
  version: 1;
  todos: SdTodoItem[];
}

export type SdTodoAddInput = {
  content: string;
  status?: SdTodoItem['status'];
  priority?: SdTodoItem['priority'];
  notes?: string;
  source?: string;
};

export type SdTodoUpdateInput = Partial<
  Pick<SdTodoItem, 'content' | 'status' | 'priority' | 'notes' | 'source'>
>;

export const TODO_STATUSES: SdTodoStatus[] = ['todo', 'doing', 'done', 'blocked', 'cancelled'];
export const TODO_PRIORITIES: SdTodoPriority[] = ['low', 'normal', 'high'];

export function isTodoStatus(value: unknown): value is SdTodoStatus {
  return TODO_STATUSES.includes(value as SdTodoStatus);
}

export function isTodoPriority(value: unknown): value is SdTodoPriority {
  return TODO_PRIORITIES.includes(value as SdTodoPriority);
}

export function isTodoItem(value: unknown): value is SdTodoItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SdTodoItem>;
  return (
    typeof item.id === 'string' && typeof item.content === 'string' && isTodoStatus(item.status)
  );
}
