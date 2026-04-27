import { DEFAULT_SD_SESSION_TITLE_MODEL } from './config.js';
import type { SdRuntime } from './runtime.js';
import { fallbackTitleFromMessages, sessionTitle } from './session-summary.js';
import { tryGenerateProviderTitle } from './session-title-provider.js';

export const DEFAULT_SESSION_TITLE_MODEL = DEFAULT_SD_SESSION_TITLE_MODEL;

export interface EnsureSessionTitleOptions {
  provider?: string;
  model?: string;
  maxTokens?: number;
}

export interface GeneratedTitle {
  text: string;
  provider: string;
  model: string;
}

export async function ensureSessionTitle(
  runtime: SdRuntime,
  options: EnsureSessionTitleOptions = {},
): Promise<string | undefined> {
  const session = runtime.session;
  if (!session) return undefined;
  const existing = sessionTitle(session.records());
  if (existing) return existing;

  const fallback = fallbackTitleFromMessages(session.messages());
  if (!fallback) return undefined;
  if (runtime.config.sessions?.title?.enabled === false) return fallback;

  const generated = await tryGenerateProviderTitle(runtime, options).catch(() => undefined);
  const cleanGenerated = cleanTitle(generated?.text);
  const title = cleanGenerated ?? fallback;
  session.appendMeta({
    title,
    title_source: cleanGenerated ? generated?.provider : 'fallback',
    title_model: cleanGenerated ? generated?.model : undefined,
  });
  return title;
}

function cleanTitle(title: string | undefined): string | undefined {
  const cleaned = title
    ?.replace(/^["'`]+|["'`.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > 72 ? cleaned.slice(0, 72).trim() : cleaned;
}
