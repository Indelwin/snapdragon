const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api';

export function codexEndpoint(baseUrl = DEFAULT_BASE_URL): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/codex/responses')) return trimmed;
  return `${trimmed}/codex/responses`;
}

export async function throwCodexProviderError(response: Response): Promise<never> {
  const text = await response.text().catch(() => '<no body>');
  throw new Error(`openai-codex ${response.status}: ${formatCodexError(text)}`);
}

function formatCodexError(payload: string): string {
  try {
    return parsedCodexError(payload);
  } catch {
    return payload;
  }
}

function parsedCodexError(payload: string): string {
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  const message = nestedString(parsed, 'error', 'message');
  if (message) return message;
  const detail = parsed.detail;
  if (typeof detail === 'string') return detail;
  return payload;
}

function nestedString(
  record: Record<string, unknown>,
  objectKey: string,
  valueKey: string,
): string | undefined {
  const nested = record[objectKey];
  if (!nested || typeof nested !== 'object') return undefined;
  const value = (nested as Record<string, unknown>)[valueKey];
  if (typeof value !== 'string') return undefined;
  return value;
}
