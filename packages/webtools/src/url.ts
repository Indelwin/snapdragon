// Typed wrapper around the `wt_url_util` dispatcher in the Rust core.
//
// The Rust dispatcher (see `crates/webtools/src/url_util.rs::dispatch`) speaks:
//
//   request  = { op: "<name>", args: { ... } }
//   response = { ok: true, value: <T> } | { ok: false, error: string }
//
// Where the inner args bag is op-specific. The exposed methods here forward
// to that ABI; if the Rust side returns `ok: false`, the wrapper throws.

import { callWasm } from './common.js';
import { loadWebtools, type WebtoolsCore } from './wasm.js';

export interface UrlUtilRequest {
  op: string;
  args: Record<string, string>;
}

/** Convenience helpers — each is a one-line dispatch into the wasm core. */
export class UrlUtils {
  constructor(private readonly core: WebtoolsCore) {}

  /** Parse, repair (add `https://` when missing), canonicalize, drop tracking. */
  normalize(raw: string): string | null {
    return this.callOptString('normalize', { raw });
  }

  /** Strict canonical form: lowercased host, sorted query, no fragment, no tracking. */
  canonicalize(raw: string): string | null {
    return this.callOptString('canonicalize', { raw });
  }

  /** Strip tracking params only — preserves the rest of the URL as-is. */
  cleanup(raw: string): string | null {
    return this.callOptString('cleanup', { raw });
  }

  /** Extract the host component of a URL. */
  host(url: string): string | null {
    return this.callOptString('host', { url });
  }

  /**
   * `true` iff `host` is the same as, or a subdomain of, `root`.
   *
   * Note: the first argument is a host string (e.g. `docs.example.com`), not a
   * URL — match the Rust signature exactly. Pass `urlUtils.host(u)` first if
   * you have a full URL.
   */
  sameOrSubdomain(host: string, root: string): boolean {
    return this.callBool('same_or_subdomain', { host, root });
  }

  /** Resolve a relative `href` against an absolute `base` URL. */
  resolve(base: string, href: string): string | null {
    return this.callOptString('resolve', { base, href });
  }

  /** Wildcard match (`*`, `?`); empty pattern matches everything. Not path-aware. */
  patternMatch(url: string, pattern: string): boolean {
    return this.callBool('pattern_match', { url, pattern });
  }

  // --- low-level call helpers -------------------------------------------

  private callRaw<T>(op: string, args: Record<string, string>): T {
    return callWasm<T>(this.core, 'url_util', op, args);
  }

  private callOptString(op: string, args: Record<string, string>): string | null {
    // `json!(Option<String>)` → string | null. Anything else is a contract bug.
    const v = this.callRaw<string | null>(op, args);
    return v === null ? null : String(v);
  }

  private callBool(op: string, args: Record<string, string>): boolean {
    return Boolean(this.callRaw<boolean>(op, args));
  }
}

/** Load wasm (cached) and return a ready-to-use `UrlUtils` instance. */
export async function urlUtils(): Promise<UrlUtils> {
  const core = await loadWebtools();
  return new UrlUtils(core);
}
