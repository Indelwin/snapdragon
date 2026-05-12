import { CamofoxClient } from './camofox.js';
import { type Chunk, contentFilter as loadContentFilter } from './content-filter.js';
import { type ExtractionResult, type Extractor, extractor as loadExtractor } from './extractor.js';
import { type FetchPageOptions, fetchPage, fetchViaJina, shouldUseJina } from './http.js';
import { type UrlUtils, urlUtils } from './url.js';

export interface WebExtractOptions extends FetchPageOptions {
  query?: string;
  maxChars?: number;
  maxChunks?: number;
  preferCamofox?: boolean;
  useJina?: boolean | 'auto';
  camofox?: CamofoxClient;
}

export interface WebExtractResult extends ExtractionResult {
  url: string;
  finalUrl: string;
  status: number;
  source: 'fetch' | 'jina' | 'camofox';
  chunks: Chunk[];
}

export async function webExtract(
  url: string,
  options: WebExtractOptions = {},
): Promise<WebExtractResult> {
  const utils = await urlUtils();
  const normalized = utils.normalize(url);
  if (!normalized) throw new Error(`invalid URL: ${url}`);
  const x = await loadExtractor();
  const f = await loadContentFilter();
  const fetched = await acquire(normalized, options, utils, x);
  const extracted = x.extract(fetched.html, options.maxChars ?? 50_000);
  const chunks = f.chunkAndFilter(extracted.markdown, {
    query: options.query,
    maxChunks: options.maxChunks ?? 8,
  });
  return {
    ...extracted,
    url: normalized,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    source: fetched.source,
    chunks,
  };
}

async function acquire(
  url: string,
  options: WebExtractOptions,
  utils: UrlUtils,
  x: Extractor,
): Promise<{
  html: string;
  finalUrl: string;
  status: number;
  source: 'fetch' | 'jina' | 'camofox';
}> {
  if (options.preferCamofox ?? true) {
    const camo = options.camofox ?? new CamofoxClient();
    if (await camo.available(options.signal)) {
      try {
        return await camo.fetchPage(url, options);
      } catch {
        // fall through to static fetch
      }
    }
  }

  const jina =
    options.useJina === true || (options.useJina !== false && (await shouldUseJina(url, utils)));
  if (jina) {
    try {
      return await fetchViaJina(url, options);
    } catch {
      // fall through to direct fetch
    }
  }

  const direct = await fetchPage(url, options);
  if ((direct.ok && !x.detectJsOnly(direct.html)) || options.useJina === false) return direct;

  try {
    return await fetchViaJina(url, options);
  } catch {
    return direct;
  }
}
