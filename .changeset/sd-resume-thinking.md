---
'@snapdragon-ai/sd': patch
---

Carry reasoning text from session-resumed messages into the TUI
transcript. The session JSONL already persists `thinking` blocks, and
the agent rehydrates them into `runtime.agent.messages` on resume,
but the UI projection layer (`messageToEntry`) was dropping the
field — so resuming a session lost the `o ` reasoning rows.

`messageToEntry` now flattens `Message.thinking: ThinkingBlock[]` into
the `ChatEntry.thinking` string used by the transcript renderer, so
resumed sessions show the same reasoning lines you saw live.
