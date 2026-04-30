export type SdIndexedKind = 'memory' | 'skill';

export type SdIndexInputMetadata = {
  title: string;
  description: string;
  tags: readonly string[];
  source: string;
  createdAt: number;
};

export type SdIndexInputEntry = {
  kind: SdIndexedKind;
  id: string;
  body: string;
  path: string;
} & Partial<SdIndexInputMetadata>;

export type SdIndexSyncResult = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
};

export type SdSearchHit = {
  kind: SdIndexedKind;
  id: string;
  title: string | undefined;
  description: string | undefined;
  body: string;
  tags: string[];
  source: string | undefined;
  path: string;
  score: number;
  accessCount: number;
  lastAccessedAt: number | undefined;
};

export type SdSearchOptions = Partial<{
  limit: number;
  touch: boolean;
}>;

export type SdDbRow = {
  kind: SdIndexedKind;
  id: string;
  title: string | null;
  description: string | null;
  body: string;
  tags: string | null;
  source: string | null;
  path: string;
  access_count: number;
  last_accessed_at: number | null;
  rank: number;
};
