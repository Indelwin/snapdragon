import type { CamofoxClient } from './camofox.js';
import type { Chunk } from './content-filter.js';
import type { ExtractionResult } from './extractor.js';
import type { FetchPageOptions } from './http.js';

export interface WebExtractOptions extends FetchPageOptions {
  query?: string;
  maxChars?: number;
  maxChunks?: number;
  preferCamofox?: boolean;
  useJina?: boolean | 'auto';
  camofox?: CamofoxClient;
}

export interface WebExtractResult extends ExtractionResult {
  url: string;
  finalUrl: string;
  status: number;
  source: 'fetch' | 'jina' | 'camofox';
  responseTruncated: boolean;
  chunks: Chunk[];
}
