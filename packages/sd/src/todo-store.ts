import { resolve } from 'node:path';
import { DEFAULT_SD_TODO_PATH, type SdConfig } from './config.js';
import type { SdProfileInfo } from './profile.js';
import { readTodoFile, writeTodoFile } from './todo-file.js';
import {
  applyTodoPatch,
  newTodoItem,
  type SdTodoAddInput,
  type SdTodoUpdateInput,
} from './todo-item.js';
import type { SdTodoItem, SdTodoStatus } from './todo-types.js';

export class SdTodoStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  list(status?: SdTodoStatus): SdTodoItem[] {
    const todos = this.read().todos;
    return status ? todos.filter((todo) => todo.status === status) : todos;
  }

  add(input: SdTodoAddInput): SdTodoItem {
    const file = this.read();
    const now = Date.now() / 1000;
    const item = newTodoItem(input, file.todos, now);
    file.todos.push(item);
    this.write(file);
    return item;
  }

  update(id: string, patch: SdTodoUpdateInput): SdTodoItem | undefined {
    const file = this.read();
    const item = file.todos.find((todo) => todo.id === id);
    if (!item) return undefined;
    applyTodoPatch(item, patch);
    item.updated_at = Date.now() / 1000;
    this.write(file);
    return item;
  }

  delete(id: string): boolean {
    const file = this.read();
    const next = file.todos.filter((todo) => todo.id !== id);
    if (next.length === file.todos.length) return false;
    this.write({ ...file, todos: next });
    return true;
  }

  private read() {
    return readTodoFile(this.path);
  }

  private write(file: ReturnType<typeof readTodoFile>): void {
    writeTodoFile(this.path, file);
  }
}

export function createSdTodoStore(config: SdConfig, profile?: SdProfileInfo): SdTodoStore {
  return new SdTodoStore(resolveTodoPath(config, profile));
}

function resolveTodoPath(config: SdConfig, profile?: SdProfileInfo): string {
  if (profile) return resolve(profile.dir, 'todos.json');
  return config.todo?.file ?? DEFAULT_SD_TODO_PATH;
}
