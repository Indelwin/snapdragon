// Tools that perform HTTP I/O: web_search, web_extract, web_crawl, web_crawl_status.

import type { Tool, ToolResult } from '@snapdragon-ai/tools';
import { crawlStatus, webCrawl } from './crawl.js';
import { webExtract } from './extract-page.js';
import { webSearch } from './search.js';
import { optionalStringArrayArg, optionalUseJina } from './toolset-args.js';
import {
  type HttpDefaults,
  jsonData,
  objectArg,
  optionalBooleanArg,
  optionalNumberArg,
  optionalStringArg,
  schema,
  stringArg,
} from './toolset-helpers.js';

export function webSearchTool(defaults: HttpDefaults): Tool {
  return {
    name: 'web_search',
    toolset: 'webtools',
    description:
      'Search the web (DuckDuckGo HTML, with optional Jina fallback). Returns ranked results.',
    parameters: schema(
      {
        query: { type: 'string' },
        maxResults: { type: 'number', default: 8 },
        useJinaFallback: { type: 'boolean', default: true },
        userAgent: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      ['query'],
    ),
    async run(args, ctx): Promise<ToolResult> {
      const input = objectArg(args);
      const results = await webSearch(stringArg(input, 'query'), {
        ...defaults,
        maxResults: optionalNumberArg(input, 'maxResults'),
        useJinaFallback: optionalBooleanArg(input, 'useJinaFallback'),
        userAgent: optionalStringArg(input, 'userAgent') ?? defaults.userAgent,
        timeoutMs: optionalNumberArg(input, 'timeoutMs') ?? defaults.timeoutMs,
        signal: ctx.signal,
      });
      const summary =
        results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n') ||
        '(no results)';
      return { content: summary, data: jsonData({ results }) };
    },
  };
}

export function webExtractTool(defaults: HttpDefaults): Tool {
  return {
    name: 'web_extract',
    toolset: 'webtools',
    description:
      'Fetch a URL and extract title, markdown, links, images, headings, and BM25-ranked chunks.',
    parameters: schema(
      {
        url: { type: 'string' },
        query: { type: 'string' },
        maxChars: { type: 'number', default: 50_000 },
        maxChunks: { type: 'number', default: 8 },
        preferCamofox: { type: 'boolean', default: true },
        useJina: {
          oneOf: [{ type: 'boolean' }, { type: 'string', enum: ['auto'] }],
        },
        userAgent: { type: 'string' },
        timeoutMs: { type: 'number' },
        maxBytes: { type: 'number' },
      },
      ['url'],
    ),
    async run(args, ctx): Promise<ToolResult> {
      const input = objectArg(args);
      const result = await webExtract(stringArg(input, 'url'), {
        query: optionalStringArg(input, 'query'),
        maxChars: optionalNumberArg(input, 'maxChars'),
        maxChunks: optionalNumberArg(input, 'maxChunks'),
        preferCamofox: optionalBooleanArg(input, 'preferCamofox'),
        useJina: optionalUseJina(input.useJina),
        userAgent: optionalStringArg(input, 'userAgent') ?? defaults.userAgent,
        timeoutMs: optionalNumberArg(input, 'timeoutMs') ?? defaults.timeoutMs,
        maxBytes: optionalNumberArg(input, 'maxBytes'),
        signal: ctx.signal,
      });
      const head = [
        `# ${result.title || '(untitled)'}`,
        result.description ? `\n${result.description}` : '',
        `\nurl: ${result.finalUrl}  status: ${result.status}  source: ${result.source}`,
        `\nlinks: ${result.links.length}  images: ${result.images.length}  headings: ${result.headings.length}  chunks: ${result.chunks.length}`,
      ].join('');
      const body = result.markdown ? `\n\n${result.markdown}` : '';
      return { content: `${head}${body}`, data: jsonData(result) };
    },
  };
}

export function webCrawlTool(defaults: HttpDefaults): Tool {
  return {
    name: 'web_crawl',
    toolset: 'webtools',
    description:
      'Breadth-first crawl from a seed URL. Returns a CrawlStatus with visited pages and any errors.',
    parameters: schema(
      {
        seed: { type: 'string' },
        maxPages: { type: 'number' },
        maxDepth: { type: 'number' },
        sameDomain: { type: 'boolean' },
        includePatterns: { type: 'array', items: { type: 'string' } },
        excludePatterns: { type: 'array', items: { type: 'string' } },
        crawlId: { type: 'string' },
        query: { type: 'string' },
        maxChars: { type: 'number' },
        maxChunks: { type: 'number' },
        preferCamofox: { type: 'boolean' },
        useJina: { oneOf: [{ type: 'boolean' }, { type: 'string', enum: ['auto'] }] },
        userAgent: { type: 'string' },
        timeoutMs: { type: 'number' },
        maxBytes: { type: 'number' },
      },
      ['seed'],
    ),
    async run(args, ctx): Promise<ToolResult> {
      const input = objectArg(args);
      const status = await webCrawl(stringArg(input, 'seed'), {
        maxPages: optionalNumberArg(input, 'maxPages'),
        maxDepth: optionalNumberArg(input, 'maxDepth'),
        sameDomain: optionalBooleanArg(input, 'sameDomain'),
        includePatterns: optionalStringArrayArg(input, 'includePatterns'),
        excludePatterns: optionalStringArrayArg(input, 'excludePatterns'),
        crawlId: optionalStringArg(input, 'crawlId'),
        query: optionalStringArg(input, 'query'),
        maxChars: optionalNumberArg(input, 'maxChars'),
        maxChunks: optionalNumberArg(input, 'maxChunks'),
        preferCamofox: optionalBooleanArg(input, 'preferCamofox'),
        useJina: optionalUseJina(input.useJina),
        userAgent: optionalStringArg(input, 'userAgent') ?? defaults.userAgent,
        timeoutMs: optionalNumberArg(input, 'timeoutMs') ?? defaults.timeoutMs,
        maxBytes: optionalNumberArg(input, 'maxBytes'),
        signal: ctx.signal,
      });
      const summary = [
        `crawl ${status.id}: ${status.status}`,
        `pages: ${status.pagesVisited}  errors: ${status.errors.length}`,
        ...status.pages.map((p) => `- [${p.depth}] ${p.finalUrl} (${p.status})`),
      ].join('\n');
      return { content: summary, data: jsonData(status) };
    },
  };
}

export function webCrawlStatusTool(): Tool {
  return {
    name: 'web_crawl_status',
    toolset: 'webtools',
    description: 'Look up the status of a previously-started crawl by id.',
    parameters: schema({ id: { type: 'string' } }, ['id']),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const status = crawlStatus(stringArg(input, 'id'));
      if (!status) return { content: `no crawl with id ${input.id}`, isError: true };
      return {
        content: `crawl ${status.id}: ${status.status}  pages: ${status.pagesVisited}  errors: ${status.errors.length}`,
        data: jsonData(status),
      };
    },
  };
}
