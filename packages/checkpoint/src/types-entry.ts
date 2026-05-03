export interface CheckpointEntry {
  hash: string;
  shortHash: string;
  /** ISO8601 author timestamp from git (e.g. `2026-05-04T14:22:31+10:00`). */
  timestamp: string;
  reason: string;
}
