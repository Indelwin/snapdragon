# @snapdragon-ai/host

Capability registry, event bus, and streaming provider adapters for Snapdragon agents.

## Providers

The host package keeps provider-specific adapters behind a uniform interface:

- Anthropic Messages
- OpenAI Responses
- OpenAI-compatible Chat Completions
- OpenAI Codex Responses

It also exports provider model discovery helpers, OpenAI Codex OAuth helpers, and
Responses-native image generation tool descriptors for agents that want hosted
image generation without owning provider-specific request shapes.
