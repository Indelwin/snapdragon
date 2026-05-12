import { fetchViaJina } from './http.js';
import type { SearchOptions, SearchResult } from './search-types.js';
import { dedupeResults } from './search-util.js';
import type { UrlUtils } from './url.js';

export async function jinaSearch(
  query: string,
  options: SearchOptions,
  utils: UrlUtils,
): Promise<SearchResult[]> {
  const target = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const response = await fetchViaJina(target, options);
  const out = response.html.split('\n').flatMap((line) => parseJinaLine(line, utils));
  return dedupeResults(out).slice(0, options.maxResults ?? 8);
}

function parseJinaLine(line: string, utils: UrlUtils): SearchResult[] {
  const match = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(line);
  const url = match ? utils.normalize(match[2] ?? '') : undefined;
  return url ? [{ title: match?.[1] ?? url, url, snippet: '', source: 'jina' }] : [];
}
