import type { FetchPageOptions } from './http.js';

export interface SearchOptions extends FetchPageOptions {
  maxResults?: number;
  useJinaFallback?: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: 'duckduckgo_html' | 'jina';
}
