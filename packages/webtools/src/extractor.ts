import { callWasm } from './common.js';
import { loadWebtools, type WebtoolsCore } from './wasm.js';

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
}
export interface SelectorExtractionResult {
  matched_nodes: number;
  texts: string[];
  html_fragments: string[];
}

export class Extractor {
  constructor(private readonly core: WebtoolsCore) {}

  extract(html: string, maxChars = 50_000): ExtractionResult {
    return callWasm<ExtractionResult>(this.core, 'extractor', 'extract', {
      html,
      max_chars: maxChars,
    });
  }

  extractBySelector(html: string, selector: string): SelectorExtractionResult {
    return callWasm<SelectorExtractionResult>(this.core, 'extractor', 'selector', {
      html,
      selector,
    });
  }

  detectJsOnly(html: string): boolean {
    return callWasm<boolean>(this.core, 'extractor', 'detect_js_only', { html });
  }
}

export async function extractor(): Promise<Extractor> {
  return new Extractor(await loadWebtools());
}
