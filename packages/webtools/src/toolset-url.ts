// URL utility tools — all pure (no network).

import type { Tool, ToolResult } from '@snapdragon-ai/tools';
import { jsonData, objectArg, schema, stringArg } from './toolset-helpers.js';
import { urlUtils as loadUrlUtils } from './url.js';

type UrlUtils = Awaited<ReturnType<typeof loadUrlUtils>>;

export function urlNormalizeTool(): Tool {
  return urlStringTool(
    'url_normalize',
    'Parse, repair (add https:// when missing), canonicalize, and drop tracking params.',
    'raw',
    (utils, v) => utils.normalize(v),
  );
}
export function urlCanonicalizeTool(): Tool {
  return urlStringTool(
    'url_canonicalize',
    'Strict canonical form: lowercased host, sorted query, no fragment, no tracking.',
    'raw',
    (utils, v) => utils.canonicalize(v),
  );
}
export function urlCleanupTool(): Tool {
  return urlStringTool(
    'url_cleanup',
    'Strip tracking params only — preserve the rest of the URL.',
    'raw',
    (utils, v) => utils.cleanup(v),
  );
}
export function urlHostTool(): Tool {
  return urlStringTool('url_host', 'Extract the host component of a URL.', 'url', (u, v) =>
    u.host(v),
  );
}

export function urlResolveTool(): Tool {
  return {
    name: 'url_resolve',
    toolset: 'webtools',
    description: 'Resolve a relative href against an absolute base URL.',
    parameters: schema({ base: { type: 'string' }, href: { type: 'string' } }, ['base', 'href']),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const utils = await loadUrlUtils();
      const v = utils.resolve(stringArg(input, 'base'), stringArg(input, 'href'));
      return { content: v ?? '(null)', data: jsonData({ value: v }) };
    },
  };
}

export function urlSameOrSubdomainTool(): Tool {
  return {
    name: 'url_same_or_subdomain',
    toolset: 'webtools',
    description:
      'Return true iff `host` equals `root` or is a subdomain of it. Both arguments are host strings, not URLs.',
    parameters: schema({ host: { type: 'string' }, root: { type: 'string' } }, ['host', 'root']),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const utils = await loadUrlUtils();
      const v = utils.sameOrSubdomain(stringArg(input, 'host'), stringArg(input, 'root'));
      return { content: String(v), data: jsonData({ value: v }) };
    },
  };
}

export function urlPatternMatchTool(): Tool {
  return {
    name: 'url_pattern_match',
    toolset: 'webtools',
    description: 'Wildcard match (`*`, `?`); empty pattern matches everything. Not path-aware.',
    parameters: schema({ url: { type: 'string' }, pattern: { type: 'string' } }, [
      'url',
      'pattern',
    ]),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const utils = await loadUrlUtils();
      const v = utils.patternMatch(stringArg(input, 'url'), stringArg(input, 'pattern'));
      return { content: String(v), data: jsonData({ value: v }) };
    },
  };
}

function urlStringTool(
  name: string,
  description: string,
  argKey: string,
  run: (utils: UrlUtils, value: string) => string | null | Promise<string | null>,
): Tool {
  return {
    name,
    toolset: 'webtools',
    description,
    parameters: schema({ [argKey]: { type: 'string' } }, [argKey]),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const utils = await loadUrlUtils();
      const v = await run(utils, stringArg(input, argKey));
      return { content: v ?? '(null)', data: jsonData({ value: v }) };
    },
  };
}
