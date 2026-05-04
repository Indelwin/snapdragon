import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isTodoItem, type SdTodoFile } from './todo-types.js';

export function readTodoFile(path: string): SdTodoFile {
  if (!existsSync(path)) return emptyTodoFile();
  try {
    return parseTodoFile(readFileSync(path, 'utf8'));
  } catch {
    return emptyTodoFile();
  }
}

export function writeTodoFile(path: string, file: SdTodoFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

function parseTodoFile(text: string): SdTodoFile {
  const parsed = JSON.parse(text) as Partial<SdTodoFile>;
  return { version: 1, todos: Array.isArray(parsed.todos) ? parsed.todos.filter(isTodoItem) : [] };
}

function emptyTodoFile(): SdTodoFile {
  return { version: 1, todos: [] };
}
