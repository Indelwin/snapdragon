import type { JsonObject } from '@snapdragon-ai/core';

export interface ToolCall {
  id: string;
  name: string;
  args_json: string;
}

export interface ThinkingBlock {
  text: string;
  signature?: string;
  encrypted_content?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  thinking?: ThinkingBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonObject;
}

export type ToolChoice = 'auto' | 'any' | 'none' | { type: 'function'; name: string };

export interface ReasoningRequest {
  enabled?: boolean;
  effort?: 'low' | 'medium' | 'high' | 'max';
  budget_tokens?: number;
  summary?: 'auto' | 'concise' | 'detailed';
}

export interface LlmChatRequest {
  role: string;
  messages: Message[];
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  reasoning?: ReasoningRequest;
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface LlmChatResponse {
  content: string;
  tool_calls?: ToolCall[];
  thinking?: ThinkingBlock[];
  tokens_in?: number;
  tokens_out?: number;
  cache_read_tokens?: number;
  finish_reason?: string;
}

export interface Profile {
  name?: string;
  persona?: string | null;
  role_to_model?: Record<string, string>;
  tool_allowlist?: string[];
  safety_policy?: string | null;
}

export interface CallContext {
  cap: string;
  runId?: string;
  profile?: Profile;
}

export type CapabilityHandler<Req = unknown, Resp = unknown> = (
  request: Req,
  context: CallContext,
) => Promise<Resp> | Resp;

export type EventListener = (payload: unknown, topic: string) => void;
