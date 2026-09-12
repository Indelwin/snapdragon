import { Extractor } from './extractor.js';
import { ddgHtml, parseDdg } from './search-ddg.js';
import { jinaSearch } from './search-jina.js';
import type { SearchOptions, SearchResult } from './search-types.js';
import { UrlUtils } from './url.js';
import { loadWebtools } from './wasm.js';

export type { SearchOptions, SearchResult } from './search-types.js';

export async function webSearch(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const core = await loadWebtools();
  const utils = new UrlUtils(core, 'borrowed');
  const extractor = new Extractor(core, 'borrowed');
  try {
    try {
      const html = await ddgHtml(query, options);
      const parsed = parseDdg(html, utils, extractor).slice(0, options.maxResults ?? 8);
      if (parsed.length > 0) return parsed;
    } catch (error) {
      if (!options.useJinaFallback) throw error;
    }
    return options.useJinaFallback === false ? [] : await jinaSearch(query, options, utils);
  } finally {
    core.dispose();
  }
}
