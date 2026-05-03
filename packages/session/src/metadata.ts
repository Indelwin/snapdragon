import type { SessionRecord } from './records.js';

export interface SessionMetadata {
  app?: string;
  provider?: string;
  model?: string;
  provider_kind?: string;
  cwd?: string;
  profile?: string | null;
  title?: string;
  title_source?: string;
  title_model?: string;
  [key: string]: unknown;
}

export function sessionMetadata(records: readonly SessionRecord[]): SessionMetadata {
  const metadata: SessionMetadata = {};
  for (const record of records) {
    if (record.type === 'session_open' && record.meta) Object.assign(metadata, record.meta);
    if (record.type === 'session_meta') Object.assign(metadata, record.meta);
  }
  return metadata;
}
