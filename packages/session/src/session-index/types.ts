export type SessionIndexSyncResult = {
  scanned: number;
  newSessions: number;
  updatedSessions: number;
  removedSessions: number;
  newMessages: number;
};

export type SessionSearchMode = 'fts' | 'trigram';

export type SessionSearchOptions = Partial<{
  limit: number;
  mode: SessionSearchMode;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  /**
   * FTS mode only. When true, pass the query straight through to FTS5
   * without auto-quoting tokens that contain punctuation (`-`, `:`, `/`, `.`).
   * Use when you want full control of FTS5 operators.
   */
  raw: boolean;
}>;

export type SessionSearchHit = {
  sessionId: string;
  rowid: number;
  storeId: number | null;
  role: string;
  createdAt: number;
  content: string;
  toolCalls: string | null;
  toolCallId: string | null;
  thinking: string | null;
  /** FTS5 bm25 rank (lower = better). Undefined for trigram mode. */
  score: number | undefined;
  sessionTitle: string | null;
  sessionUpdatedAt: number | null;
};

export type SessionRowSummary = {
  sessionId: string;
  jsonlPath: string;
  title: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  messageCount: number;
  jsonlSize: number;
};
