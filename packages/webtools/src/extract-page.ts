import { ContentFilter } from './content-filter.js';
import { acquireExtractPage } from './extract-acquire.js';
import type { WebExtractOptions, WebExtractResult } from './extract-types.js';
import { Extractor } from './extractor.js';
import {
  assertByteLength,
  boundedInteger,
  MAX_EXTRACTED_CHARS,
  MAX_FILTER_CHUNKS,
  MAX_FILTER_QUERY_BYTES,
  MAX_URL_BYTES,
} from './resource-limits.js';
import { UrlUtils } from './url.js';
import { loadWebtools } from './wasm.js';

export type { WebExtractOptions, WebExtractResult } from './extract-types.js';

export async function webExtract(
  url: string,
  options: WebExtractOptions = {},
): Promise<WebExtractResult> {
  const core = await loadWebtools();
  const utils = new UrlUtils(core);
  const extractor = new Extractor(core);
  const filter = new ContentFilter(core);
  try {
    const normalized = utils.normalize(url);
    if (!normalized) throw new Error(`invalid URL: ${url}`);
    assertByteLength(normalized, 'URL bytes', MAX_URL_BYTES);
    const maxChars = boundedInteger(
      options.maxChars,
      50_000,
      'extracted markdown characters',
      1,
      MAX_EXTRACTED_CHARS,
    );
    const maxChunks = boundedInteger(options.maxChunks, 8, 'filtered chunks', 0, MAX_FILTER_CHUNKS);
    if (options.query)
      assertByteLength(options.query, 'filter query bytes', MAX_FILTER_QUERY_BYTES);
    const fetched = await acquireExtractPage(normalized, options, utils, extractor);
    const extracted = extractor.extract(fetched.html, maxChars);
    const chunks = filter.chunkAndFilter(extracted.markdown, {
      query: options.query,
      maxChunks,
    });
    return {
      ...extracted,
      url: normalized,
      finalUrl: fetched.finalUrl,
      status: fetched.status,
      source: fetched.source,
      responseTruncated: fetched.truncated,
      chunks,
    };
  } finally {
    core.dispose();
  }
}
