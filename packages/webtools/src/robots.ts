import { callWasm } from './common.js';
import { loadWebtools, type WebtoolsCore } from './wasm.js';

export interface RobotsCheck {
  allowed: boolean;
  matched_rule: string | null;
  crawl_delay: number | null;
  sitemaps: string[];
}

export class Robots {
  constructor(private readonly core: WebtoolsCore) {}

  check(body: string, url: string, userAgent = 'SnapdragonCrawler/0.1'): RobotsCheck {
    return callWasm<RobotsCheck>(this.core, 'robots', 'check', {
      body,
      url,
      user_agent: userAgent,
    });
  }

  sitemaps(body: string): string[] {
    return callWasm<string[]>(this.core, 'robots', 'sitemaps', { body });
  }
}

export async function robots(): Promise<Robots> {
  return new Robots(await loadWebtools());
}
