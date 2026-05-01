import type { StreamingChatHandler } from '../registry.js';
import type { ProviderDescriptor } from '../types.js';
import { codexEndpoint, throwCodexProviderError } from './codex-http.js';
import { codexInputItems } from './codex-input.js';
import { openAIResponsesBody } from './openai-responses-format.js';
import { readResponsesStream } from './responses-stream.js';
import { type FetchLike, fetchImpl } from './shared.js';

const PROVIDER = 'openai-codex';

export type { CodexModelId } from '../codex-models.js';
export {
  CODEX_MODEL_LIMITS,
  CODEX_MODELS,
  codexModelLimits,
} from '../codex-models.js';
export { listCodexModels } from '../model-discovery.js';

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
  /** Codex rejects max_output_tokens; kept for source compatibility and ignored. */
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
    const response = await fetchImpl(options.fetch)(codexEndpoint(options.baseUrl), {
      method: 'POST',
      headers: requestHeaders(auth),
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwCodexProviderError(response);
    if (!response.body) throw new Error('openai-codex: missing response body');
    return readResponsesStream(response.body, PROVIDER, context);
  };
}

function patchCodexBody(body: Record<string, unknown>, options: CodexProviderOptions): void {
  delete body.max_output_tokens;
  body.input = codexInputItems(body.input);
  body.text = { verbosity: 'medium' };
  body.include = ['reasoning.encrypted_content'];
  body.parallel_tool_calls = true;
  if (options.promptCacheKey) body.prompt_cache_key = options.promptCacheKey;
  if (!body.reasoning && options.reasoningEffort) {
    body.reasoning = { effort: options.reasoningEffort, summary: 'auto' };
  }
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
