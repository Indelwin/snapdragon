import { fetchImpl } from './providers/shared.js';
import type { ListModelsOptions, ProviderModel } from './types.js';

export const CODEX_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
] as const;

export function listCodexModels(): ProviderModel[] {
  return CODEX_MODELS.map((id) => ({
    id,
    source: 'static',
    capabilities: {
      streaming: true,
      tools: true,
      imageInput: true,
      fileInput: true,
      reasoning: true,
      modelDiscovery: 'static',
      imageGeneration: 'responses-tool',
    },
  }));
}

export async function listAnthropicModels(
  options: Pick<ListModelsOptions, 'apiKey' | 'baseUrl' | 'apiVersion' | 'fetch'>,
): Promise<ProviderModel[]> {
  if (!options.apiKey) throw new Error('apiKey is required for Anthropic model discovery');
  const response = await fetchImpl(options.fetch)(
    `${anthropicBaseUrl(options.baseUrl)}/v1/models`,
    {
      headers: {
        'x-api-key': options.apiKey,
        'anthropic-version': options.apiVersion ?? '2023-06-01',
      },
    },
  );
  if (!response.ok) await throwModelDiscoveryError('anthropic', response);
  const data = (await response.json()) as {
    data?: Array<{ id: string; display_name?: string; created_at?: string }>;
  };
  return sortModels(
    (data.data ?? []).map((model) => ({
      id: model.id,
      name: model.display_name,
      created: model.created_at ? Date.parse(model.created_at) : undefined,
      source: 'api',
    })),
  );
}

export async function listOpenAIResponsesModels(
  options: Pick<
    ListModelsOptions,
    'apiKey' | 'baseUrl' | 'extraHeaders' | 'organization' | 'fetch'
  >,
): Promise<ProviderModel[]> {
  return listOpenAICompatibleModels({
    ...options,
    baseUrl: options.baseUrl ?? 'https://api.openai.com/v1',
  });
}

export async function listOpenAICompatibleModels(
  options: Pick<
    ListModelsOptions,
    'apiKey' | 'baseUrl' | 'extraHeaders' | 'organization' | 'fetch'
  >,
): Promise<ProviderModel[]> {
  const response = await fetchImpl(options.fetch)(`${baseUrl(options.baseUrl)}/models`, {
    headers: openAIModelHeaders(options),
  });
  if (!response.ok) await throwModelDiscoveryError('openai-compatible', response);
  const data = (await response.json()) as {
    data?: Array<{ id: string; name?: string; created?: number }>;
  };
  return sortModels(
    (data.data ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      created: model.created,
      source: 'api',
    })),
  );
}

export function sortModels(models: ProviderModel[]): ProviderModel[] {
  return [...models].sort((a, b) => {
    if (a.created !== undefined && b.created !== undefined) return b.created - a.created;
    if (a.created !== undefined) return -1;
    if (b.created !== undefined) return 1;
    return a.id.localeCompare(b.id);
  });
}

function baseUrl(value: string | undefined): string {
  return (value ?? 'https://api.openai.com/v1').replace(/\/$/, '');
}

function anthropicBaseUrl(value: string | undefined): string {
  return (value ?? 'https://api.anthropic.com').replace(/\/$/, '');
}

function openAIModelHeaders(
  options: Pick<ListModelsOptions, 'apiKey' | 'extraHeaders' | 'organization'>,
): Record<string, string> {
  const headers: Record<string, string> = { ...(options.extraHeaders ?? {}) };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  if (options.organization) headers['OpenAI-Organization'] = options.organization;
  return headers;
}

async function throwModelDiscoveryError(provider: string, response: Response): Promise<never> {
  const text = await response.text().catch(() => '<no body>');
  throw new Error(`${provider} models ${response.status}: ${text}`);
}
