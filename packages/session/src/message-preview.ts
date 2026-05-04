import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseMessagePreview } from './message-preview-parse.js';
import type { ReadMessagePreviewsOptions, SessionMessagePreview } from './message-preview-types.js';

export type { ReadMessagePreviewsOptions, SessionMessagePreview } from './message-preview-types.js';

/**
 * Stream session JSONL and project message records into the tiny shape used by
 * background scanners. This intentionally avoids full JSON.parse on tool
 * result records, which can contain large command output and should not be
 * loaded just to discover user text or assistant tool-call sequences.
 */
export async function readMessagePreviews(
  path: string,
  options: ReadMessagePreviewsOptions = {},
): Promise<SessionMessagePreview[]> {
  if (!existsSync(path)) return [];
  const out: SessionMessagePreview[] = [];
  const roles = options.roles ? new Set(options.roles) : undefined;
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of lines) {
    const preview = parseMessagePreview(rawLine, options);
    if (!preview) continue;
    if (roles && !roles.has(preview.role)) continue;
    if (options.afterCreatedAt !== undefined && preview.created_at <= options.afterCreatedAt) {
      continue;
    }
    out.push(preview);
  }

  return out;
}
