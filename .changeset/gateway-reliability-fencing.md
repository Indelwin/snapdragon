---
"@snapdragon-ai/gateway": patch
"@snapdragon-ai/sd": patch
---

Harden gateway job, service, IPC, and Pi RPC lifecycle ownership under
concurrency and backpressure. Job completion, failure, and renewal now require
the lease id and attempt returned by acquire, and `sd gateway` forwards and
documents those fences.

Gateway transports now reject oversized or busy work explicitly, paginate
growing collections, bound streamed previews and traces while preserving full
owned artifacts, and join owned processes, observers, sockets, and service
tasks during cancellation or shutdown.
