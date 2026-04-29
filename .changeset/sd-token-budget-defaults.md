---
'@snapdragon-ai/sd': minor
---

Bump the default token budgets so reasoning-enabled prompts actually
get a chance to produce a reply.

- `agent.max_tokens` is now **32_000** (was unset → fell through to
  the host package's hardcoded 4096). With reasoning enabled by
  default, the model spent a chunk of that 4K budget on thinking and
  hit `finish_reason=max_tokens` before producing any final text —
  visible as silent `(empty)` rows pre-PR-#23/#24, and as the new
  `provider returned only reasoning, no final content
  (finish_reason=max_tokens)` error event after.

- `agent.context.max_request_tokens` is now **400_000** (was 120_000).
  Claude's 1M-token context window allows up to ~400K of input
  before quality starts to noticeably degrade — that's the headroom
  target for context windowing now.

Both can still be overridden in `~/.snapdragon/sd/config.yaml`.
