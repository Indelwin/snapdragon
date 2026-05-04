import type { SdSessionIndex } from '@snapdragon-ai/session';
import type { Tool, ToolResult, Toolset } from '@snapdragon-ai/tools';
import {
  optionalMode,
  optionalNumber,
  optionalRole,
  SEARCH_MODES,
  SEARCH_ROLES,
} from './search-messages-args.js';
import { formatHitsForLLM, serializeHit } from './search-messages-format.js';
import { jsonData, objectArgOrEmpty, optionalString, schema, stringArg } from './todo-args.js';

export function searchMessagesToolset(index: SdSessionIndex): Toolset {
  return {
    name: 'search',
    title: 'Session search',
    description: 'Full-text and substring search over indexed session messages.',
    tools: [searchMessagesTool(index)],
  };
}

function searchMessagesTool(index: SdSessionIndex): Tool {
  return {
    name: 'search_messages',
    toolset: 'search',
    description:
      'Search past session messages by full-text (FTS5) or substring (trigram). ' +
      'Returns the most recent matches across all sessions on disk.',
    parameters: schema(
      {
        query: { type: 'string' },
        mode: { type: 'string', enum: [...SEARCH_MODES] },
        role: { type: 'string', enum: [...SEARCH_ROLES] },
        session_id: { type: 'string' },
        limit: { type: 'number' },
      },
      ['query'],
    ),
    async run(args): Promise<ToolResult> {
      return runSearch(index, objectArgOrEmpty(args));
    },
  };
}

function runSearch(index: SdSessionIndex, input: Record<string, unknown>): ToolResult {
  const query = stringArg(input, 'query');
  const mode = optionalMode(input.mode);
  const role = optionalRole(input.role);
  const sessionId = optionalString(input.session_id);
  const limit = optionalNumber(input.limit, 20, 1, 100);
  const hits = index.search(query, {
    mode,
    ...(role ? { role } : {}),
    ...(sessionId ? { sessionId } : {}),
    limit,
  });
  return {
    content: formatHitsForLLM(hits),
    data: jsonData({
      query,
      mode: mode ?? 'fts',
      count: hits.length,
      hits: hits.map(serializeHit),
    }),
  };
}
