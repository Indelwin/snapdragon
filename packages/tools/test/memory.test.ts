import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  MemoryAppendRequest,
  MemoryEntry,
  MemoryManageRequest,
  MemoryProvider,
  MemoryReadRequest,
  MemorySearchRequest,
} from '@snapdragon-ai/content';
import { memoryToolset, ToolRegistry } from '../src/index.ts';

test('memory toolset reads, searches, and appends through provider contract', async () => {
  const provider = new InMemoryProvider();
  const registry = new ToolRegistry({ cwd: process.cwd() });
  await registry.register(memoryToolset({ provider, authoring: true }));

  const appended = await registry.invoke('memory_append', {
    content: 'Prefer focused tests.',
    title: 'Testing',
  });
  const search = await registry.invoke('memory_search', { query: 'tests' });
  const read = await registry.invoke('memory_read', {});

  assert.equal(appended.isError, false);
  assert.match(search.content, /Prefer focused tests/);
  assert.match(read.content, /Testing/);
});

test('memory authoring can be disabled', async () => {
  const registry = new ToolRegistry({ cwd: process.cwd() });
  await registry.register(memoryToolset({ provider: new InMemoryProvider(), authoring: false }));

  const result = await registry.invoke('memory_append', { content: 'no' });

  assert.equal(result.isError, true);
  assert.match(result.content, /disabled/);
});

class InMemoryProvider implements MemoryProvider {
  entries: MemoryEntry[] = [];

  info() {
    return { id: 'test', writable: true };
  }

  read(_request: MemoryReadRequest = {}) {
    return { entries: this.entries };
  }

  search(request: MemorySearchRequest) {
    return this.entries.filter((entry) => entry.content.includes(request.query));
  }

  append(request: MemoryAppendRequest) {
    const id = `${this.entries.length + 1}`;
    this.entries.push({ id, content: request.content, title: request.title });
    return { success: true, action: 'append' as const, id };
  }

  manage(request: MemoryManageRequest) {
    if (request.action === 'append') return this.append(request);
    return { success: false, action: request.action };
  }
}
