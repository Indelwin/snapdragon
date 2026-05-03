export interface CheckpointRestoreResult {
  success: boolean;
  restoredTo?: string;
  reason?: string;
  directory?: string;
  /** Set when only a single file was restored. */
  file?: string;
  error?: string;
}
