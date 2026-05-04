import type { SessionMessageRecord, SessionOpenRecord, SessionRecord } from '../records.js';

export type PartitionedSessionRecords = {
  openRecord: SessionOpenRecord | undefined;
  messageRecords: SessionMessageRecord[];
  lastMessageTs: number | undefined;
};

export function partitionRecords(records: readonly SessionRecord[]): PartitionedSessionRecords {
  const partitioned: PartitionedSessionRecords = {
    openRecord: undefined,
    messageRecords: [],
    lastMessageTs: undefined,
  };
  for (const record of records) addRecord(partitioned, record);
  return partitioned;
}

function addRecord(partitioned: PartitionedSessionRecords, record: SessionRecord): void {
  if (record.type === 'session_open') partitioned.openRecord = record;
  else if (record.type === 'message') {
    partitioned.messageRecords.push(record);
    partitioned.lastMessageTs = record.created_at;
  }
}
