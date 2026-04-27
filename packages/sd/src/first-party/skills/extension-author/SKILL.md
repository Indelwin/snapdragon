---
name: extension-author
description: Design or scaffold Snapdragon extensions with explicit capabilities and safe manifests.
tags: [extensions, plugins, systems]
---

Use this skill when adding or reviewing a Snapdragon extension.

Extensions should declare capabilities in a manifest before loading behavior. Keep executable code trusted and local. Treat tools, providers, skills, UI renderers, memory providers, and sandbox backends as components or systems that can be registered by the host.

For this early extension model:
- Create a clear manifest with id, name, version, description, capabilities, and contributions.
- Keep sandbox backends optional and replaceable.
- Do not load remote code.
- Do not grant filesystem, shell, auth, or network access implicitly.

Prefer a minimal manifest and one small contribution over a broad extension that changes many runtime surfaces at once.
