import type { WebExtractOptions } from './extract-types.js';
import { type FetchPageResult, fetchViaJina, shouldUseJina } from './http.js';
import { isResourceLimitError } from './resource-limits.js';
import type { UrlUtils } from './url.js';

export async function shouldAttemptJina(
  url: string,
  options: WebExtractOptions,
  utils: UrlUtils,
): Promise<boolean> {
  if (options.useJina === true) return true;
  if (options.useJina === false) return false;
  return shouldUseJina(url, utils);
}

export async function tryJina(
  url: string,
  options: WebExtractOptions,
  preserveResourceErrors = true,
): Promise<FetchPageResult | undefined> {
  try {
    return await fetchViaJina(url, options);
  } catch (error) {
    if (preserveResourceErrors && isResourceLimitError(error)) throw error;
    return undefined;
  }
}
