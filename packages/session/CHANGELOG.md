# @snapdragon-ai/session

## 0.2.0

### Minor Changes

- 36943c9: Add the TypeScript foundation for provider-neutral multimodal content, provider
  adapters, portable JSONL sessions, config contracts, toolset filtering, and
  session-aware agents.
- 73ab03b: Add append-only JSONL context chunks, deterministic fresh-tail context assembly, and automatic agent-side session compaction. `sd` now enables conservative context windowing by default under `agent.context` while keeping canonical session messages lossless.

### Patch Changes

- Updated dependencies [36943c9]
- Updated dependencies [4d7a6a1]
- Updated dependencies [e3ad840]
- Updated dependencies [e786135]
  - @snapdragon-ai/host@0.2.0
