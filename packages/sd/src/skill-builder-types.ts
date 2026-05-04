export interface SkillBuilderMessageRecord {
  role: string;
  created_at: number;
  content?: string;
  tool_calls?: Array<{ name: string; args_json?: string }>;
}

export interface SkillBuilderTraceEntry {
  call: { name: string; args_json?: string };
  recordIndex: number;
}

export interface CandidateExample {
  sessionId: string;
  /** Most-recent user prompt text before the n-gram (truncated). */
  precedingPrompt: string;
  /** Tool calls in n-gram order with truncated args. */
  calls: Array<{ name: string; args: string }>;
}

export interface SdSkillPattern {
  /** Stable id derived from the n-gram (e.g. 'read_file→write_file'). */
  id: string;
  ngram: string[];
  totalCount: number;
  distinctSessions: number;
  exampleSessions: string[];
  /** Up to 3 example occurrences with surrounding user-prompt context. */
  examples?: CandidateExample[];
}

export interface BuilderState {
  version: 1;
  /** Per-session high-watermark message timestamp processed. */
  sessions: Record<string, { last_processed_at: number }>;
  /** Hashes of candidates already surfaced — never re-emit the same one. */
  emitted: string[];
  /** Hashes of candidates already turned into a draft SKILL.md. */
  drafted?: string[];
}

export interface SdSkillBuilderScanResult {
  scanned_sessions: number;
  patterns_found: number;
  candidates_emitted: number;
  drafts_written: number;
  errors: string[];
}
