# @snapdragon-ai/webtools

## 0.2.0

### Minor Changes

- 8d0e986: Register `@snapdragon-ai/webtools` as an agent-facing toolset.

  `webtoolsToolset()` (new `packages/webtools/src/toolset.ts`) wraps every
  public function in the package as a `Tool`, exposing 18 tools under the
  `webtools` toolset:

  - `web_search`, `web_extract`, `web_crawl`, `web_crawl_status`
  - `url_normalize`, `url_canonicalize`, `url_cleanup`, `url_host`,
    `url_resolve`, `url_same_or_subdomain`, `url_pattern_match`
  - `robots_check`, `robots_sitemaps`
  - `extract_html`, `extract_html_selector`, `extract_detect_js_only`
  - `content_filter_chunk`, `content_filter_best`

  `sd` wires the toolset into the runtime registry and adds an
  `SdWebtoolsConfig` block (`enabled`, `default_user_agent`,
  `default_timeout_ms`), defaulting to enabled.

  `@snapdragon-ai/webtools` now depends on `@snapdragon-ai/core` and
  `@snapdragon-ai/tools` so it can produce `Tool`/`Toolset` values
  directly. Agents that don't want web access can disable it with
  `webtools: { enabled: false }`.

### Patch Changes

- Updated dependencies [36943c9]
- Updated dependencies [97ce057]
  - @snapdragon-ai/tools@0.2.0
  - @snapdragon-ai/core@0.2.0
