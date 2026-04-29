import type { JsonObject } from '@snapdragon-ai/core';
import type { MessageContent } from './content-types.js';
import type { ProviderCapabilities } from './provider-types.js';

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
  content: MessageContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  thinking?: ThinkingBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonObject;
}

export interface ImageGenerationToolDefinition {
  type: 'image_generation';
  model?: 'gpt-image-2' | 'gpt-image-1.5' | 'gpt-image-1' | 'gpt-image-1-mini' | string;
  size?: 'auto' | '1024x1024' | '1024x1536' | '1536x1024' | string;
  quality?: 'auto' | 'low' | 'medium' | 'high' | string;
  background?: 'auto' | 'transparent' | 'opaque' | string;
  output_format?: 'png' | 'jpeg' | 'webp' | string;
  output_compression?: number;
  partial_images?: number;
  action?: 'auto' | 'generate' | 'edit';
}

export type NativeToolDefinition = ImageGenerationToolDefinition;

export type ToolChoice = 'auto' | 'any' | 'none' | { type: 'function'; name: string };

export interface ReasoningRequest {
  enabled?: boolean;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  budget_tokens?: number;
  summary?: 'auto' | 'concise' | 'detailed';
}

export interface LlmChatRequest {
  role: string;
  messages: Message[];
  tools?: ToolDefinition[];
  native_tools?: NativeToolDefinition[];
  tool_choice?: ToolChoice;
  reasoning?: ReasoningRequest;
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface LlmChatResponse {
  content: string;
  tool_calls?: ToolCall[];
  generated_images?: GeneratedImage[];
  thinking?: ThinkingBlock[];
  tokens_in?: number;
  tokens_out?: number;
  cache_read_tokens?: number;
  finish_reason?: string;
}

export interface GeneratedImage {
  id?: string;
  result?: string;
  revised_prompt?: string;
  partial?: boolean;
  partial_index?: number;
  provider_metadata?: Record<string, unknown>;
}

export interface ProviderModel {
  id: string;
  name?: string;
  created?: number;
  source?: 'api' | 'static';
  capabilities?: Partial<ProviderCapabilities>;
}

export interface ListModelsOptions {
  apiKey?: string;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  organization?: string;
  apiVersion?: string;
  fetch?: typeof fetch;
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

export type {
  ContentBlock,
  FileContentBlock,
  FileSource,
  ImageContentBlock,
  ImageDetail,
  ImageSource,
  MessageContent,
  TextContentBlock,
  ToolResultContentBlock,
} from './content-types.js';
export type { ProviderCapabilities, ProviderDescriptor } from './provider-types.js';
