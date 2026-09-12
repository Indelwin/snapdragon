import { callWasm } from './common.js';
import {
  assertByteLength,
  boundedInteger,
  MAX_EXTRACTED_CHARS,
  MAX_HTML_INPUT_BYTES,
} from './resource-limits.js';
import { loadWebtools, type WebtoolsCore } from './wasm.js';
import { disposeOwnedCore, type WebtoolsCoreOwnership } from './wasm-ownership.js';

export interface LinkInfo {
  href: string;
  text: string;
}
export interface ImageInfo {
  src: string;
  alt: string;
}
export interface HeadingInfo {
  level: number;
  text: string;
}
export interface ExtractionResult {
  title: string;
  description: string;
  markdown: string;
  text_length: number;
  links: LinkInfo[];
  images: ImageInfo[];
  headings: HeadingInfo[];
  truncation: {
    markdown: boolean;
    metadata: boolean;
  };
}
export interface SelectorExtractionResult {
  matched_nodes: number;
  texts: string[];
  html_fragments: string[];
}

export class Extractor {
  constructor(
    private readonly core: WebtoolsCore,
    private readonly ownership: WebtoolsCoreOwnership,
  ) {}

  dispose(): void {
    disposeOwnedCore(this.core, this.ownership);
  }

  extract(html: string, maxChars = 50_000): ExtractionResult {
    validateHtml(html);
    const boundedMaxChars = boundedInteger(
      maxChars,
      50_000,
      'extracted markdown characters',
      1,
      MAX_EXTRACTED_CHARS,
    );
    return callWasm<ExtractionResult>(this.core, 'extractor', 'extract', {
      html,
      max_chars: boundedMaxChars,
    });
  }

  extractBySelector(html: string, selector: string): SelectorExtractionResult {
    validateHtml(html);
    assertByteLength(selector, 'CSS selector bytes', 4_096);
    return callWasm<SelectorExtractionResult>(this.core, 'extractor', 'selector', {
      html,
      selector,
    });
  }

  detectJsOnly(html: string): boolean {
    validateHtml(html);
    return callWasm<boolean>(this.core, 'extractor', 'detect_js_only', { html });
  }
}

export async function extractor(): Promise<Extractor> {
  return new Extractor(await loadWebtools(), 'owned');
}

function validateHtml(html: string): void {
  assertByteLength(html, 'HTML input bytes', MAX_HTML_INPUT_BYTES);
}
