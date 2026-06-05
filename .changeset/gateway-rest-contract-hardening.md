---
'@snapdragon-ai/gateway': patch
---

Harden REST/SSE integration contracts.

The REST server now treats path prefixes as full path segments, returns `400`
for malformed JSON request bodies, and keeps the SSE stream protocol stable when
writing initial world snapshot events.
