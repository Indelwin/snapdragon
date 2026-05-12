// Content-filter tools: BM25 chunk ranking against an optional query.

import type { Tool, ToolResult } from '@snapdragon-ai/tools';
import { contentFilter as loadContentFilter } from './content-filter.js';
import {
  jsonData,
  objectArg,
  optionalNumberArg,
  optionalStringArg,
  schema,
  stringArg,
} from './toolset-helpers.js';

export function contentFilterChunkTool(): Tool {
  return {
    name: 'content_filter_chunk',
    toolset: 'webtools',
    description: 'Chunk markdown and BM25-rank chunks against an optional query.',
    parameters: schema(
      {
        markdown: { type: 'string' },
        query: { type: 'string' },
        maxChunks: { type: 'number', default: 8 },
        minChars: { type: 'number' },
      },
      ['markdown'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const cf = await loadContentFilter();
      const chunks = cf.chunkAndFilter(stringArg(input, 'markdown'), {
        query: optionalStringArg(input, 'query'),
        maxChunks: optionalNumberArg(input, 'maxChunks'),
        minChars: optionalNumberArg(input, 'minChars'),
      });
      const summary =
        chunks
          .map((c) => `[${c.index} score=${c.score.toFixed(3)} tokens=${c.token_count}]\n${c.text}`)
          .join('\n\n') || '(no chunks)';
      return { content: summary, data: jsonData({ chunks }) };
    },
  };
}

export function contentFilterBestTool(): Tool {
  return {
    name: 'content_filter_best',
    toolset: 'webtools',
    description: 'Return the single best-scoring chunk for an optional query.',
    parameters: schema({ markdown: { type: 'string' }, query: { type: 'string' } }, ['markdown']),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const cf = await loadContentFilter();
      const best = cf.bestChunk(stringArg(input, 'markdown'), optionalStringArg(input, 'query'));
      return {
        content: best ? best.text : '(no chunks)',
        data: jsonData({ chunk: best }),
      };
    },
  };
}
