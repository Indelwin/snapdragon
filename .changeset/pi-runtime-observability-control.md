---
"@snapdragon-ai/gateway": patch
"@snapdragon-ai/sd": patch
---

Add gateway-owned runtime breadcrumbs and cancellation control for Pi agent jobs.
Workers can append durable logs through the gateway client, cancelled jobs stay
terminal, and `sd` now aborts running Pi RPC jobs when the gateway job is
cancelled while preserving inspectable job-targeted logs.
