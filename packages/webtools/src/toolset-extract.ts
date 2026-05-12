// HTML extraction tools that operate on caller-supplied HTML (no network).

import type { Tool, ToolResult } from '@snapdragon-ai/tools';
import { extractor as loadExtractor } from './extractor.js';
import { jsonData, objectArg, optionalNumberArg, schema, stringArg } from './toolset-helpers.js';

export function extractHtmlTool(): Tool {
  return {
    name: 'extract_html',
    toolset: 'webtools',
    description:
      'Extract title, markdown, links, images, headings from an HTML document. Use web_extract if you need to fetch.',
    parameters: schema(
      { html: { type: 'string' }, maxChars: { type: 'number', default: 50_000 } },
      ['html'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const ex = await loadExtractor();
      const result = ex.extract(
        stringArg(input, 'html'),
        optionalNumberArg(input, 'maxChars') ?? 50_000,
      );
      return {
        content: `# ${result.title || '(untitled)'}\n\n${result.markdown}`,
        data: jsonData(result),
      };
    },
  };
}

export function extractHtmlSelectorTool(): Tool {
  return {
    name: 'extract_html_selector',
    toolset: 'webtools',
    description:
      'Run a CSS selector against an HTML document; returns matched text and HTML fragments.',
    parameters: schema({ html: { type: 'string' }, selector: { type: 'string' } }, [
      'html',
      'selector',
    ]),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const ex = await loadExtractor();
      const result = ex.extractBySelector(stringArg(input, 'html'), stringArg(input, 'selector'));
      return {
        content: `matched ${result.matched_nodes}\n\n${result.texts.join('\n---\n')}`,
        data: jsonData(result),
      };
    },
  };
}

export function extractDetectJsOnlyTool(): Tool {
  return {
    name: 'extract_detect_js_only',
    toolset: 'webtools',
    description:
      'Heuristic: returns true if the HTML appears to be a JS-only shell needing a browser to render.',
    parameters: schema({ html: { type: 'string' } }, ['html']),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const ex = await loadExtractor();
      const v = ex.detectJsOnly(stringArg(input, 'html'));
      return { content: String(v), data: jsonData({ value: v }) };
    },
  };
}
