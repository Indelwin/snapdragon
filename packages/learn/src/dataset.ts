import type { LearnEnvironment } from './environment.js';

export interface ExpectedToolCall {
  name: string;
  inputContains?: Record<string, unknown>;
  outputContains?: string | string[];
}

export interface TaskExample {
  id: string;
  prompt: string;
  category?: string;
  requiresTools?: boolean;
  requiredTools?: string[];
  forbiddenTools?: string[];
  maxToolCalls?: number;
  expectedOutputContains?: string[];
  expectedToolCalls?: ExpectedToolCall[];
  environment?: string;
  verify?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LearningDataset {
  id: string;
  examples: TaskExample[];
  environments?: LearnEnvironment[];
  metadata?: Record<string, unknown>;
}
