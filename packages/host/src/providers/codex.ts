import type { StreamingChatHandler } from '../registry.js';
import type { ProviderDescriptor } from '../types.js';
import { openAIResponsesBody } from './openai-responses-format.js';
import { readResponsesStream } from './responses-stream.js';
import { type FetchLike, fetchImpl } from './shared.js';

const PROVIDER = 'openai-codex';
const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api';

export { CODEX_MODELS, listCodexModels } from '../model-discovery.js';

export interface CodexAuth {
  accessToken: string;
  accountId?: string;
}

export interface CodexProviderOptions {
  model: string;
  auth: CodexAuth | (() => CodexAuth | Promise<CodexAuth>);
  baseUrl?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  promptCacheKey?: string;
  defaultMaxTokens?: number;
  fetch?: FetchLike;
}

export const codexProviderDescriptor: ProviderDescriptor = {
  id: PROVIDER,
  name: 'OpenAI Codex',
  protocol: 'openai.codex.responses',
  capabilities: {
    streaming: true,
    tools: true,
    imageInput: true,
    fileInput: true,
    reasoning: true,
    modelDiscovery: 'static',
    imageGeneration: 'responses-tool',
  },
};

export function codexProvider(options: CodexProviderOptions): StreamingChatHandler {
  return async (request, context) => {
    const auth = await resolveAuth(options.auth);
    const { body } = openAIResponsesBody(options.model, request);
    patchCodexBody(body, options);
    context.emit({
      kind: 'started',
      run_id: context.runId,
      provider: PROVIDER,
      role: request.role,
      model: options.model,
    });
    const response = await fetchImpl(options.fetch)(endpoint(options.baseUrl), {
      method: 'POST',
      headers: requestHeaders(auth),
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwProviderError(response);
    if (!response.body) throw new Error('openai-codex: missing response body');
    return readResponsesStream(response.body, PROVIDER, context);
  };
}

function patchCodexBody(body: Record<string, unknown>, options: CodexProviderOptions): void {
  body.text = { verbosity: 'medium' };
  body.include = ['reasoning.encrypted_content'];
  body.parallel_tool_calls = true;
  if (options.defaultMaxTokens && body.max_output_tokens === undefined) {
    body.max_output_tokens = options.defaultMaxTokens;
  }
  if (options.promptCacheKey) body.prompt_cache_key = options.promptCacheKey;
  if (!body.reasoning && options.reasoningEffort) {
    body.reasoning = { effort: options.reasoningEffort, summary: 'auto' };
  }
}

function endpoint(baseUrl = DEFAULT_BASE_URL): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return trimmed.endsWith('/codex/responses') ? trimmed : `${trimmed}/codex/responses`;
}

function requestHeaders(auth: CodexAuth): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    authorization: `Bearer ${auth.accessToken}`,
    'openai-beta': 'responses=experimental',
    originator: 'snapdragon',
  };
  if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId;
  return headers;
}

async function resolveAuth(auth: CodexProviderOptions['auth']): Promise<CodexAuth> {
  return typeof auth === 'function' ? auth() : auth;
}

async function throwProviderError(response: Response): Promise<never> {
  const text = await response.text().catch(() => '<no body>');
  throw new Error(`openai-codex ${response.status}: ${formatError(text)}`);
}

function formatError(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { detail?: string; error?: { message?: string } };
    return parsed.error?.message ?? parsed.detail ?? payload;
  } catch {
    return payload;
  }
}
