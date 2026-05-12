// Agent-facing toolset wrapping every public webtools function.
//
// This module is opt-in: agents that don't need web access can simply not
// register it. Consumers (e.g. `@snapdragon-ai/sd`) import `webtoolsToolset()`
// and pass the result to `agent.registry.register(...)`.
//
// Tool surface:
//   - web_search, web_extract, web_crawl, web_crawl_status
//   - url_normalize, url_canonicalize, url_cleanup, url_host,
//     url_resolve, url_same_or_subdomain, url_pattern_match
//   - robots_check, robots_sitemaps
//   - extract_html, extract_html_selector, extract_detect_js_only
//   - content_filter_chunk, content_filter_best
//
// All tool results return human-readable text in `content` and the parsed
// structured value in `data`.

import type { Toolset } from '@snapdragon-ai/tools';
import { contentFilterBestTool, contentFilterChunkTool } from './toolset-content-filter.js';
import {
  extractDetectJsOnlyTool,
  extractHtmlSelectorTool,
  extractHtmlTool,
} from './toolset-extract.js';
import type { HttpDefaults } from './toolset-helpers.js';
import { robotsCheckTool, robotsSitemapsTool } from './toolset-robots.js';
import {
  urlCanonicalizeTool,
  urlCleanupTool,
  urlHostTool,
  urlNormalizeTool,
  urlPatternMatchTool,
  urlResolveTool,
  urlSameOrSubdomainTool,
} from './toolset-url.js';
import { webCrawlStatusTool, webCrawlTool, webExtractTool, webSearchTool } from './toolset-web.js';

export interface WebtoolsToolsetOptions {
  /** Default User-Agent applied to HTTP-bearing tools. */
  defaultUserAgent?: string;
  /** Default per-request timeout (ms) for HTTP-bearing tools. */
  defaultTimeoutMs?: number;
}

export function webtoolsToolset(options: WebtoolsToolsetOptions = {}): Toolset {
  const httpDefaults: HttpDefaults = {
    userAgent: options.defaultUserAgent,
    timeoutMs: options.defaultTimeoutMs,
  };
  return {
    name: 'webtools',
    title: 'Web tools',
    description:
      'Search the web, fetch & extract pages, crawl sites, evaluate robots.txt, and manipulate URLs.',
    tools: [
      webSearchTool(httpDefaults),
      webExtractTool(httpDefaults),
      webCrawlTool(httpDefaults),
      webCrawlStatusTool(),
      urlNormalizeTool(),
      urlCanonicalizeTool(),
      urlCleanupTool(),
      urlHostTool(),
      urlResolveTool(),
      urlSameOrSubdomainTool(),
      urlPatternMatchTool(),
      robotsCheckTool(),
      robotsSitemapsTool(),
      extractHtmlTool(),
      extractHtmlSelectorTool(),
      extractDetectJsOnlyTool(),
      contentFilterChunkTool(),
      contentFilterBestTool(),
    ],
  };
}
