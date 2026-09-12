import { callWasm } from './common.js';
import {
  assertByteLength,
  boundedInteger,
  MAX_FILTER_CHUNKS,
  MAX_FILTER_INPUT_BYTES,
  MAX_FILTER_QUERY_BYTES,
} from './resource-limits.js';
import { loadWebtools, type WebtoolsCore } from './wasm.js';
import { disposeOwnedCore, type WebtoolsCoreOwnership } from './wasm-ownership.js';

export interface Chunk {
  index: number;
  text: string;
  token_count: number;
  score: number;
}

export interface ChunkOptions {
  query?: string;
  maxChunks?: number;
  minChars?: number;
}

export class ContentFilter {
  constructor(
    private readonly core: WebtoolsCore,
    private readonly ownership: WebtoolsCoreOwnership,
  ) {}

  dispose(): void {
    disposeOwnedCore(this.core, this.ownership);
  }

  chunkAndFilter(markdown: string, options: ChunkOptions = {}): Chunk[] {
    validateFilterInput(markdown, options.query);
    const maxChunks = boundedInteger(options.maxChunks, 8, 'filtered chunks', 0, MAX_FILTER_CHUNKS);
    const minChars = boundedInteger(options.minChars, 30, 'minimum chunk characters', 1, 100_000);
    return callWasm<Chunk[]>(this.core, 'content_filter', 'chunk', {
      markdown,
      query: options.query,
      max_chunks: maxChunks,
      min_chars: minChars,
    });
  }

  bestChunk(markdown: string, query?: string): Chunk | null {
    validateFilterInput(markdown, query);
    return callWasm<Chunk | null>(this.core, 'content_filter', 'best', { markdown, query });
  }
}

export async function contentFilter(): Promise<ContentFilter> {
  return new ContentFilter(await loadWebtools(), 'owned');
}

function validateFilterInput(markdown: string, query?: string): void {
  assertByteLength(markdown, 'content filter input bytes', MAX_FILTER_INPUT_BYTES);
  if (query) assertByteLength(query, 'content filter query bytes', MAX_FILTER_QUERY_BYTES);
}
