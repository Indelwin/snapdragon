export interface RolloutMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolTraceStep {
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  success: boolean;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface RolloutTrace {
  id?: string;
  exampleId: string;
  output: string;
  messages?: RolloutMessage[];
  toolCalls: ToolTraceStep[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  tokenUsage?: TokenUsage;
  metadata?: Record<string, unknown>;
}
