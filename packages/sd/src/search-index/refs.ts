import type { DatabaseSync } from 'node:sqlite';
import type { SdIndexedKind } from './types.js';

export function recordCrossRef(
  db: DatabaseSync,
  src: { kind: SdIndexedKind; id: string },
  dst: { kind: SdIndexedKind; id: string },
  rel: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO cross_refs (src_kind, src_id, dst_kind, dst_id, rel)
     VALUES ($src_kind, $src_id, $dst_kind, $dst_id, $rel)`,
  ).run({
    $src_kind: src.kind,
    $src_id: src.id,
    $dst_kind: dst.kind,
    $dst_id: dst.id,
    $rel: rel,
  });
}
