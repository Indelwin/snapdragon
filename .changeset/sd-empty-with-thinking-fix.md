---
'@snapdragon-ai/agent': patch
---

Fix the empty-content error event firing for reasoning-enabled runs.

The previous heuristic was:

```ts
if (isEmptyContent(response.content) && !response.thinking?.length)
```

i.e. "only emit the error when both content **and** thinking are
empty". With `agent.reasoning` enabled by default (Anthropic adaptive
thinking), the dominant failure mode is **content empty, thinking
present** — the model thinks through the prompt and then bails before
producing any final text. The original heuristic explicitly excluded
that path, which is why users kept seeing silent `(empty)` rows even
after the prior PR shipped.

The check now fires on empty content alone, regardless of thinking.
The error message also splits into two variants so reasoning-only
failures are clearly labelled:

> `provider returned only reasoning, no final content
> (finish_reason=end_turn); the model thought through the prompt but
> bailed before producing text — try rephrasing or disabling
> reasoning`
