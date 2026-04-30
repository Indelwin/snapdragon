import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { countEntries, getEntry, inboundRefCount } from './read.js';
import { recordCrossRef } from './refs.js';
import { SCHEMA, SCHEMA_VERSION } from './schema.js';
import { searchEntries } from './search.js';
import { syncEntries } from './sync.js';
import { touchEntries } from './touch.js';
import type { SdIndexedKind, SdIndexInputEntry, SdSearchOptions } from './types.js';

export class SdSearchIndex {
  readonly path: string;
  #db: DatabaseSync;

  private constructor(path: string, db: DatabaseSync) {
    this.path = path;
    this.#db = db;
  }

  static open(path: string): SdSearchIndex {
    if (path !== ':memory:') ensureParentDir(path);
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(SCHEMA);
    db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES ($key, $value)').run({
      $key: 'schema_version',
      $value: String(SCHEMA_VERSION),
    });
    return new SdSearchIndex(path, db);
  }

  close(): void {
    this.#db.close();
  }

  sync(kind: SdIndexedKind, entries: readonly SdIndexInputEntry[]) {
    return syncEntries(this.#db, kind, entries);
  }

  search(query: string, kind: SdIndexedKind, options: SdSearchOptions = {}) {
    return searchEntries(this.#db, query, kind, options);
  }

  touch(kind: SdIndexedKind, ids: readonly string[]): void {
    touchEntries(this.#db, kind, ids);
  }

  get(kind: SdIndexedKind, id: string) {
    return getEntry(this.#db, kind, id);
  }

  count(kind: SdIndexedKind): number {
    return countEntries(this.#db, kind);
  }

  recordRef(
    src: { kind: SdIndexedKind; id: string },
    dst: { kind: SdIndexedKind; id: string },
    rel: string,
  ): void {
    recordCrossRef(this.#db, src, dst, rel);
  }

  inboundRefs(target: { kind: SdIndexedKind; id: string }): number {
    return inboundRefCount(this.#db, target.kind, target.id);
  }
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
}
