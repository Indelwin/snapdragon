import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { deleteSession, listKnownSessionIds } from './session-row.js';
import type { SessionIndexSyncResult } from './types.js';

export type FileSnapshot = {
  sessionId: string;
  filePath: string;
  fileSize: number;
  fileMtime: number;
};

export function listSessionFiles(sessionRoot: string): FileSnapshot[] {
  const out: FileSnapshot[] = [];
  for (const entry of readdirSync(sessionRoot)) {
    const snapshot = fileSnapshotForEntry(sessionRoot, entry);
    if (snapshot) out.push(snapshot);
  }
  return out;
}

export function removeDeletedSessions(
  db: DatabaseSync,
  onDisk: Set<string>,
  result: SessionIndexSyncResult,
): void {
  for (const id of listKnownSessionIds(db)) {
    if (onDisk.has(id)) continue;
    deleteSession(db, id);
    result.removedSessions += 1;
  }
}

function fileSnapshotForEntry(sessionRoot: string, entry: string): FileSnapshot | undefined {
  if (!entry.endsWith('.jsonl')) return undefined;
  const filePath = join(sessionRoot, entry);
  const fileStats = statSync(filePath);
  if (!fileStats.isFile()) return undefined;
  return {
    sessionId: entry.slice(0, -'.jsonl'.length),
    filePath,
    fileSize: fileStats.size,
    fileMtime: fileStats.mtimeMs / 1000,
  };
}
