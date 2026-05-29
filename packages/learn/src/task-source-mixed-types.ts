import type { TaskSource } from './task-source.js';

export interface MixedSourceWeight {
  source: TaskSource;
  weight: number;
}
