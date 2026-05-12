import { callWasm } from './common.js';
import { loadWebtools, type WebtoolsCore } from './wasm.js';

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
  constructor(private readonly core: WebtoolsCore) {}

  chunkAndFilter(markdown: string, options: ChunkOptions = {}): Chunk[] {
    return callWasm<Chunk[]>(this.core, 'content_filter', 'chunk', {
      markdown,
      query: options.query,
      max_chunks: options.maxChunks,
      min_chars: options.minChars,
    });
  }

  bestChunk(markdown: string, query?: string): Chunk | null {
    return callWasm<Chunk | null>(this.core, 'content_filter', 'best', { markdown, query });
  }
}

export async function contentFilter(): Promise<ContentFilter> {
  return new ContentFilter(await loadWebtools());
}
