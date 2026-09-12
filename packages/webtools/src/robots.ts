import { callWasm } from './common.js';
import { assertByteLength, MAX_ROBOTS_BYTES } from './resource-limits.js';
import { loadWebtools, type WebtoolsCore } from './wasm.js';
import { disposeOwnedCore, type WebtoolsCoreOwnership } from './wasm-ownership.js';

export interface RobotsCheck {
  allowed: boolean;
  matched_rule: string | null;
  crawl_delay: number | null;
  sitemaps: string[];
}

export class Robots {
  constructor(
    private readonly core: WebtoolsCore,
    private readonly ownership: WebtoolsCoreOwnership,
  ) {}

  dispose(): void {
    disposeOwnedCore(this.core, this.ownership);
  }

  check(body: string, url: string, userAgent = 'SnapdragonCrawler/0.1'): RobotsCheck {
    validateRobotsBody(body);
    return callWasm<RobotsCheck>(this.core, 'robots', 'check', {
      body,
      url,
      user_agent: userAgent,
    });
  }

  sitemaps(body: string): string[] {
    validateRobotsBody(body);
    return callWasm<string[]>(this.core, 'robots', 'sitemaps', { body });
  }
}

export async function robots(): Promise<Robots> {
  return new Robots(await loadWebtools(), 'owned');
}

function validateRobotsBody(body: string): void {
  assertByteLength(body, 'robots.txt input bytes', MAX_ROBOTS_BYTES);
}
