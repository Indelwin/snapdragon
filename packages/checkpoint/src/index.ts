export { isDestructiveCommand } from './destructive.js';
export { CheckpointManager } from './manager.js';
export {
  getWorkingDirForPath,
  isValidCommitHash,
  relativeWithinWorkTree,
} from './path-policy.js';
export { shadowRepoPath } from './shadow-repo.js';
export type {
  CheckpointDiffResult,
  CheckpointEntry,
  CheckpointManagerOptions,
  CheckpointRestoreResult,
} from './types.js';
