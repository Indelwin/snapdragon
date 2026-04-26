import { strict as assert } from 'node:assert';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SessionStore } from '../src/index.ts';

test('JSONL sessions create, append, reopen, assemble, and delete', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_1', { provider: 'mock' });

  session.appendMessage({
    role: 'user',
    content: [
      { type: 'text', text: 'describe' },
      { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
    ],
  });
  session.appendMessage({
    role: 'assistant',
    content: 'calling',
    tool_calls: [{ id: 'call_1', name: 'read', args_json: '{"path":"README.md"}' }],
    thinking: [{ text: 'think', signature: 'sig_1' }],
  });
  session.appendMeta({ title: 'Fixture' });

  const reopened = store.open('session_1');
  assert.equal(reopened.messages().length, 2);
  assert.equal(reopened.assemble({ system: 'system' })[0].role, 'system');
  assert.deepEqual(reopened.messages()[1].tool_calls, [
    { id: 'call_1', name: 'read', args_json: '{"path":"README.md"}' },
  ]);
  assert.equal(store.list()[0].session_id, 'session_1');
  assert.equal(store.delete('session_1'), true);
  assert.equal(store.exists('session_1'), false);
});

test('JSONL sessions skip malformed trailing lines', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_2');
  session.appendMessage({ role: 'user', content: 'hello' });
  appendFileSync(session.jsonlPath, '{"type": "message"\n', 'utf8');

  assert.equal(store.open('session_2').messages().length, 1);
});
