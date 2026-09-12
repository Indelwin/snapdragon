import { recordIdFromPrefix } from './record-envelope.js';

export type ProjectedRecordIdentity =
  | { type: 'message'; store_id: number }
  | { type: 'context_chunk'; chunk_id: number };

export function projectedRecordIdentity(line: string): ProjectedRecordIdentity | undefined {
  const storeId = recordIdFromPrefix(line, 'message', 'store_id');
  if (storeId !== undefined) return { type: 'message', store_id: storeId };
  const chunkId = recordIdFromPrefix(line, 'context_chunk', 'chunk_id');
  return chunkId === undefined ? undefined : { type: 'context_chunk', chunk_id: chunkId };
}

export function validRecordId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
