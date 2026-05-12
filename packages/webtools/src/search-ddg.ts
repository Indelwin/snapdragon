import type { Extractor } from './extractor.js';
import type { SearchOptions, SearchResult } from './search-types.js';
import { cleanText, dedupeResults, firstCapture, firstMatch, htmlDecode } from './search-util.js';
import type { UrlUtils } from './url.js';

export async function ddgHtml(query: string, options: SearchOptions): Promise<string> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`https://duckduckgo.com/html/?${params}`, {
    signal: options.signal,
    headers: {
      'user-agent': options.userAgent ?? 'SnapdragonCrawler/0.1',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTML search failed: ${res.status}`);
  return await res.text();
}

export function parseDdg(html: string, utils: UrlUtils, extractor: Extractor): SearchResult[] {
  const out: SearchResult[] = [];
  for (const block of resultBlocks(html, extractor)) {
    const result = parseResultBlock(block, utils);
    if (result) out.push(result);
  }
  return dedupeResults(out);
}

function resultBlocks(html: string, extractor: Extractor): string[] {
  const selected = extractor.extractBySelector(html, '.result');
  return selected.html_fragments.length > 0
    ? selected.html_fragments
    : html.split(/<div[^>]+class=["'][^"']*result[^"']*/i);
}

function parseResultBlock(block: string, utils: UrlUtils): SearchResult | undefined {
  const link = resultLink(block);
  if (!link) return undefined;
  const url = resultUrl(link[1] ?? '', utils);
  const title = cleanText(link[2] ?? '');
  if (!url || !title) return undefined;
  return {
    title,
    url,
    snippet: resultSnippet(block),
    source: 'duckduckgo_html',
  };
}

function resultLink(block: string): RegExpMatchArray | null {
  return (
    firstMatch(
      block,
      /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    ) ?? firstMatch(block, /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
  );
}

function resultUrl(raw: string, utils: UrlUtils): string | undefined {
  const decoded = htmlDecode(raw);
  const uddg = /[?&]uddg=([^&]+)/.exec(decoded)?.[1];
  return utils.normalize(uddg ? decodeURIComponent(uddg) : decoded) ?? undefined;
}

function resultSnippet(block: string): string {
  return cleanText(
    firstCapture(block, /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i) ??
      '',
  );
}
