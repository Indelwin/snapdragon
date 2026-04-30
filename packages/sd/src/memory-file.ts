import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function ensureMemoryFile(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    ['# Snapdragon Memory', '', 'Durable notes captured by sd and explicit memory tools.', ''].join(
      '\n',
    ),
    'utf8',
  );
}

export function readRawMemory(path: string): string {
  ensureMemoryFile(path);
  return readFileSync(path, 'utf8');
}

export function appendRawMemory(path: string, entry: string): void {
  ensureMemoryFile(path);
  const raw = readRawMemory(path);
  atomicWriteMemory(path, normalizeMemoryFile(`${raw.trimEnd()}\n\n${entry}`));
}

export function atomicWriteMemory(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempDir = join(tmpdir(), `snapdragon-memory-${Date.now()}-${Math.random().toString(36)}`);
  mkdirSync(tempDir, { recursive: true });
  const temp = join(tempDir, 'write.tmp');
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, path);
  rmSync(tempDir, { recursive: true, force: true });
}

export function normalizeMemoryFile(content: string): string {
  if (content.endsWith('\n')) return content;
  return `${content}\n`;
}
