// robots.txt evaluation tools.

import type { Tool, ToolResult } from '@snapdragon-ai/tools';
import { robots as loadRobots } from './robots.js';
import { jsonData, objectArg, optionalStringArg, schema, stringArg } from './toolset-helpers.js';

export function robotsCheckTool(): Tool {
  return {
    name: 'robots_check',
    toolset: 'webtools',
    description:
      'Evaluate a robots.txt body against a URL and user-agent. Returns the matched rule.',
    parameters: schema(
      {
        body: { type: 'string' },
        url: { type: 'string' },
        userAgent: { type: 'string', default: 'SnapdragonCrawler/0.1' },
      },
      ['body', 'url'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const robots = await loadRobots();
      const result = robots.check(
        stringArg(input, 'body'),
        stringArg(input, 'url'),
        optionalStringArg(input, 'userAgent') ?? 'SnapdragonCrawler/0.1',
      );
      return {
        content: `allowed=${result.allowed} rule=${result.matched_rule ?? '(none)'} delay=${result.crawl_delay ?? '(none)'} sitemaps=${result.sitemaps.length}`,
        data: jsonData(result),
      };
    },
  };
}

export function robotsSitemapsTool(): Tool {
  return {
    name: 'robots_sitemaps',
    toolset: 'webtools',
    description: 'Extract sitemap URLs declared in a robots.txt body.',
    parameters: schema({ body: { type: 'string' } }, ['body']),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const robots = await loadRobots();
      const sitemaps = robots.sitemaps(stringArg(input, 'body'));
      return { content: sitemaps.join('\n') || '(none)', data: jsonData({ sitemaps }) };
    },
  };
}
