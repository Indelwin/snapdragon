export interface CheckpointDiffResult {
  success: boolean;
  /** `git diff --stat` output when `success` is true. */
  stat?: string;
  /** Full unified diff when `success` is true. */
  diff?: string;
  error?: string;
}
