import type { SessionOpenRecord } from '../records.js';

export type ExistingSessionRow = {
  message_count: number;
  created_at: number | null;
  title: string | null;
};

export type UpsertSessionArgs = {
  sessionId: string;
  jsonlPath: string;
  jsonlSize: number;
  jsonlMtime: number;
  lastIndexedOffset: number;
  openRecord: SessionOpenRecord | undefined;
  messageDelta: number;
  lastMessageTs: number | undefined;
  /** When true, this is a fresh-from-zero indexing pass; reset message_count. */
  replace: boolean;
};
