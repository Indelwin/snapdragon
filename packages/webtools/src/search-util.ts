import type { SearchResult } from './search-types.js';

export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

export function firstMatch(value: string, pattern: RegExp): RegExpMatchArray | null {
  return value.match(pattern);
}

export function firstCapture(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1];
}

export function cleanText(value: string): string {
  return htmlDecode(
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function htmlDecode(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}
