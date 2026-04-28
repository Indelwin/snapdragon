---
'@snapdragon-ai/sd': minor
---

Add a running indicator with a breathing-pink spinner and a "shimmer"
animation for the thinking placeholder and the latest reasoning line.

While a run is active, the prompt footer now shows
`<spinner> <Thinking|Connecting|Streaming|Running tool>...` instead of
the empty-cursor we used to show. The phase is derived from existing
provider events (`started`, `thinking`, `text`, `tool_call_start`) so
no new wire-format is needed; provider-extension authors get the
indicator for free.

Reasoning rows in the transcript now shimmer on the most recent line
while the entry is streaming, then go calm once the run ends. Note
that reasoning blocks only appear when a model is configured with
`agent.reasoning` (or per-provider `reasoning`) — by default, no
reasoning is requested, so no `o ` lines render. Configure
`reasoning.{enabled: true, effort: 'medium'}` in your `sd` config to
see them.

The new effects live in `packages/sd/src/tui/renderers/effects.tsx`
and own their own animation timers (cleared on unmount), so they're
zero-deps and safe to drop into any Ink tree.
