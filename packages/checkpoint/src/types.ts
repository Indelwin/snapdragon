/**
 * Public types for `@snapdragon-ai/checkpoint`.
 *
 * The checkpoint package gives an agent loop a fail-quiet "snapshot before a
 * destructive tool call, restore on demand" safety net, modelled on the
 * design used by hermes-agent.  See README for the whole picture.
 */

export type { CheckpointDiffResult } from './types-diff.js';
export type { CheckpointEntry } from './types-entry.js';
export type { CheckpointManagerOptions } from './types-options.js';
export type { CheckpointRestoreResult } from './types-restore.js';
