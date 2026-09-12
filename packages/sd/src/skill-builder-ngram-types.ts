import type { CandidateExample } from './skill-builder-types.js';

export interface NgramEntry {
  ngram: string[];
  count: number;
  sessions: Set<string>;
  examples: CandidateExample[];
}

export type NgramStats = Map<string, NgramEntry>;
