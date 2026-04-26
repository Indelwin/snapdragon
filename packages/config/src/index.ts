import type { MessageContent, ProviderDescriptor, ReasoningRequest } from '@snapdragon-ai/host';

export type ProviderKind =
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
  | 'openai-codex'
  | 'custom'
  | (string & {});

export interface ResolvedProviderConfig {
  id: string;
  kind: ProviderKind;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  descriptor?: ProviderDescriptor;
  reasoning?: ReasoningRequest;
}

export interface ResolvedToolsetsConfig {
  enabled: string[];
  disabled: string[];
  allowedTools?: string[];
  deniedTools: string[];
  sandboxRoot?: string;
  options: Record<string, Record<string, unknown>>;
}

export interface ResolvedSessionConfig {
  enabled: boolean;
  root?: string;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

export interface ResolvedAgentConfig {
  provider: ResolvedProviderConfig;
  toolsets: ResolvedToolsetsConfig;
  session?: ResolvedSessionConfig;
  systemPrompt?: MessageContent;
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
  reasoning?: ReasoningRequest;
}

export interface ToolsetsConfigInput {
  enabled?: string[];
  disabled?: string[];
  allowedTools?: string[];
  deniedTools?: string[];
  allowed_tools?: string[];
  denied_tools?: string[];
  sandboxRoot?: string;
  sandbox_root?: string;
  options?: Record<string, Record<string, unknown>>;
}

export function normalizeToolsetsConfig(input: ToolsetsConfigInput = {}): ResolvedToolsetsConfig {
  return {
    enabled: unique(input.enabled ?? []),
    disabled: unique(input.disabled ?? []),
    allowedTools: optionalUnique(input.allowedTools ?? input.allowed_tools),
    deniedTools: unique(input.deniedTools ?? input.denied_tools ?? []),
    sandboxRoot: input.sandboxRoot ?? input.sandbox_root,
    options: input.options ?? {},
  };
}

export function normalizeSessionConfig(
  input: Partial<ResolvedSessionConfig> = {},
): ResolvedSessionConfig {
  const out: ResolvedSessionConfig = { enabled: input.enabled ?? true };
  if (input.root) out.root = input.root;
  if (input.sessionId) out.sessionId = input.sessionId;
  if (input.meta) out.meta = input.meta;
  return out;
}

export function normalizeProviderConfig(input: ResolvedProviderConfig): ResolvedProviderConfig {
  if (!input.id.trim()) throw new Error('provider id is required');
  if (!input.model.trim()) throw new Error('provider model is required');
  return {
    ...input,
    id: input.id.trim(),
    model: input.model.trim(),
  };
}

function optionalUnique(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const normalized = unique(values);
  return normalized.length > 0 ? normalized : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
