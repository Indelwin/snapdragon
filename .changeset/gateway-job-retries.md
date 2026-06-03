---
"@snapdragon-ai/gateway": patch
"@snapdragon-ai/sd": patch
---

Add durable job retry semantics across the Rust daemon, TypeScript facade, REST
API, and `sd gateway jobs retry` so failed work can be requeued without losing
operator-visible attempt history.
