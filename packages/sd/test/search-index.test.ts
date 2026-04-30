import assert from 'node:assert/strict';
import test from 'node:test';
import { type SdIndexInputEntry, SdSearchIndex } from '../src/search-index.ts';

function memoryEntry(
  id: string,
  body: string,
  extras: Partial<SdIndexInputEntry> = {},
): SdIndexInputEntry {
  return {
    kind: 'memory',
    id,
    title: extras.title,
    description: extras.description,
    body,
    tags: extras.tags ?? [],
    source: extras.source,
    path: extras.path ?? `/tmp/MEMORY.md#${id}`,
    createdAt: extras.createdAt ?? Date.parse('2026-01-01T00:00:00Z'),
  };
}

function skillEntry(
  id: string,
  body: string,
  extras: Partial<SdIndexInputEntry> = {},
): SdIndexInputEntry {
  return {
    kind: 'skill',
    id,
    title: extras.title ?? id,
    description: extras.description,
    body,
    tags: extras.tags ?? [],
    source: extras.source,
    path: extras.path ?? `/tmp/skills/${id}/SKILL.md`,
  };
}

test('opens an in-memory db, applies the schema, and reports zero counts initially', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    assert.equal(idx.count('memory'), 0);
    assert.equal(idx.count('skill'), 0);
  } finally {
    idx.close();
  }
});

test('sync inserts new entries and reports counts', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    const result = idx.sync('memory', [
      memoryEntry('m1', 'remember to run pack dry before release'),
      memoryEntry('m2', 'always run linter before pushing'),
    ]);
    assert.equal(result.added, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.removed, 0);
    assert.equal(result.unchanged, 0);
    assert.equal(idx.count('memory'), 2);
  } finally {
    idx.close();
  }
});

test('sync is idempotent: a second pass with identical content updates nothing', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    const inputs = [memoryEntry('m1', 'alpha'), memoryEntry('m2', 'bravo')];
    idx.sync('memory', inputs);
    const second = idx.sync('memory', inputs);
    assert.equal(second.added, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.removed, 0);
    assert.equal(second.unchanged, 2);
  } finally {
    idx.close();
  }
});

test('sync removes rows whose ids are absent from the new input set', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('memory', [memoryEntry('m1', 'a'), memoryEntry('m2', 'b'), memoryEntry('m3', 'c')]);
    const result = idx.sync('memory', [memoryEntry('m1', 'a')]);
    assert.equal(result.removed, 2);
    assert.equal(idx.count('memory'), 1);
    assert.ok(idx.get('memory', 'm1'));
    assert.equal(idx.get('memory', 'm2'), undefined);
  } finally {
    idx.close();
  }
});

test('content edits trigger update and preserve access counters', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('memory', [memoryEntry('m1', 'first version')]);
    idx.touch('memory', ['m1']);
    idx.touch('memory', ['m1']);
    const before = idx.get('memory', 'm1');
    assert.equal(before?.accessCount, 2);

    const second = idx.sync('memory', [memoryEntry('m1', 'second version with new text')]);
    assert.equal(second.updated, 1);
    assert.equal(second.added, 0);

    const after = idx.get('memory', 'm1');
    assert.equal(after?.accessCount, 2, 'access counter survives content edits');
    assert.match(after?.body ?? '', /second version/);
  } finally {
    idx.close();
  }
});

test('search returns FTS hits ordered by bm25 with prefix matching', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('memory', [
      memoryEntry('m1', 'remember to run pack dry before release', { title: 'release checklist' }),
      memoryEntry('m2', 'always run linter before pushing', { title: 'pre push hook' }),
      memoryEntry('m3', 'unrelated note about coffee', { title: 'coffee' }),
    ]);
    const hits = idx.search('release pack', 'memory');
    // Both m1 (matches release+pack) and m2 (matches nothing here) — only
    // m1 should come back.
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.id, 'm1');
    assert.match(hits[0]?.body ?? '', /pack dry/);
  } finally {
    idx.close();
  }
});

test('search prefix-matches partial words via FTS5 prefix tokens', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('skill', [
      skillEntry('test-driven-fix-loop', 'Run failing tests then edit the implementation'),
      skillEntry('release-flow', 'pack dry then publish'),
    ]);
    const hits = idx.search('test', 'skill');
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.id, 'test-driven-fix-loop');
    // 'fail' should also match via prefix.
    const partial = idx.search('fail', 'skill');
    assert.equal(partial.length, 1);
    assert.equal(partial[0]?.id, 'test-driven-fix-loop');
  } finally {
    idx.close();
  }
});

test('search with touch=true increments access counters on hits', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('memory', [memoryEntry('m1', 'remember to run pack dry')]);
    idx.search('pack', 'memory', { touch: true });
    idx.search('pack', 'memory', { touch: true });
    idx.search('pack', 'memory', { touch: true });
    const row = idx.get('memory', 'm1');
    assert.equal(row?.accessCount, 3);
    assert.ok(row?.lastAccessedAt && row.lastAccessedAt > 0);
  } finally {
    idx.close();
  }
});

test('search without touch leaves counters at zero', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('memory', [memoryEntry('m1', 'remember to run pack dry')]);
    idx.search('pack', 'memory'); // no touch
    const row = idx.get('memory', 'm1');
    assert.equal(row?.accessCount, 0);
    assert.equal(row?.lastAccessedAt, undefined);
  } finally {
    idx.close();
  }
});

test("search filters by kind so memory and skill indices don't cross-pollute", () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('memory', [memoryEntry('m1', 'release pack dry')]);
    idx.sync('skill', [skillEntry('release-flow', 'pack dry then publish')]);
    const memoryHits = idx.search('pack', 'memory');
    const skillHits = idx.search('pack', 'skill');
    assert.equal(memoryHits.length, 1);
    assert.equal(memoryHits[0]?.kind, 'memory');
    assert.equal(skillHits.length, 1);
    assert.equal(skillHits[0]?.kind, 'skill');
  } finally {
    idx.close();
  }
});

test('search sanitizes punctuation and quotes in the query', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('memory', [memoryEntry('m1', 'remember the rule about quotes', { tags: ['parser'] })]);
    // Each of these should NOT throw and should match m1.
    for (const q of ['"remember"', 'remember; quotes', 'rules!?', '   remember   ']) {
      const hits = idx.search(q, 'memory');
      assert.ok(hits.length >= 1, `query ${JSON.stringify(q)} should match`);
    }
  } finally {
    idx.close();
  }
});

test('cross_refs round-trip and inbound-count', () => {
  const idx = SdSearchIndex.open(':memory:');
  try {
    idx.sync('skill', [
      skillEntry('a', 'first'),
      skillEntry('b', 'second'),
      skillEntry('c', 'third'),
    ]);
    idx.recordRef({ kind: 'skill', id: 'b' }, { kind: 'skill', id: 'a' }, 'references');
    idx.recordRef({ kind: 'skill', id: 'c' }, { kind: 'skill', id: 'a' }, 'references');
    // Idempotent: same triple again is a no-op.
    idx.recordRef({ kind: 'skill', id: 'b' }, { kind: 'skill', id: 'a' }, 'references');
    assert.equal(idx.inboundRefs({ kind: 'skill', id: 'a' }), 2);
    assert.equal(idx.inboundRefs({ kind: 'skill', id: 'b' }), 0);
  } finally {
    idx.close();
  }
});
