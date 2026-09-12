import { CamofoxClient } from './camofox.js';
import { shouldAttemptJina, tryJina } from './extract-jina.js';
import type { WebExtractOptions } from './extract-types.js';
import type { Extractor } from './extractor.js';
import { type FetchPageResult, fetchPage } from './http.js';
import { isResourceLimitError } from './resource-limits.js';
import type { UrlUtils } from './url.js';

export async function acquireExtractPage(
  url: string,
  options: WebExtractOptions,
  utils: UrlUtils,
  extractor: Extractor,
): Promise<FetchPageResult> {
  const rendered = await tryCamofox(url, options);
  if (rendered) return rendered;

  if (await shouldAttemptJina(url, options, utils)) {
    const response = await tryJina(url, options);
    if (response) return response;
  }

  const direct = await fetchPage(url, options);
  if ((direct.ok && !extractor.detectJsOnly(direct.html)) || options.useJina === false) {
    return direct;
  }
  return (await tryJina(url, options, false)) ?? direct;
}

async function tryCamofox(
  url: string,
  options: WebExtractOptions,
): Promise<FetchPageResult | undefined> {
  if (!(options.preferCamofox ?? true)) return undefined;
  const client = options.camofox ?? new CamofoxClient();
  if (!(await client.available(options.signal))) return undefined;
  try {
    return await client.fetchPage(url, options);
  } catch (error) {
    if (isResourceLimitError(error)) throw error;
    return undefined;
  }
}
