import { extractor as loadExtractor } from './extractor.js';
import { ddgHtml, parseDdg } from './search-ddg.js';
import { jinaSearch } from './search-jina.js';
import type { SearchOptions, SearchResult } from './search-types.js';
import { urlUtils } from './url.js';

export type { SearchOptions, SearchResult } from './search-types.js';

export async function webSearch(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const utils = await urlUtils();
  const extractor = await loadExtractor();
  try {
    const html = await ddgHtml(query, options);
    const parsed = parseDdg(html, utils, extractor).slice(0, options.maxResults ?? 8);
    if (parsed.length > 0) return parsed;
  } catch (error) {
    if (!options.useJinaFallback) throw error;
  }
  return options.useJinaFallback === false ? [] : jinaSearch(query, options, utils);
}
