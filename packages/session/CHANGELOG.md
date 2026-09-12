# @snapdragon-ai/session

## 0.2.0

### Minor Changes

- 3e01d51: Add the TypeScript foundation for provider-neutral multimodal content, provider
  adapters, portable JSONL sessions, config contracts, toolset filtering, and
  session-aware agents.
- b6b6058: Add append-only JSONL context chunks, deterministic fresh-tail context assembly, and automatic agent-side session compaction. `sd` now enables conservative context windowing by default under `agent.context` while keeping canonical session messages lossless.

### Patch Changes

- Updated dependencies [3e01d51]
- Updated dependencies [06f11a6]
- Updated dependencies [733ef06]
- Updated dependencies [89ef7d8]
  - @snapdragon-ai/host@0.2.0
