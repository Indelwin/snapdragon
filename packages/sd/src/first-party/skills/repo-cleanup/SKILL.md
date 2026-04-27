---
name: repo-cleanup
description: Clean up local repo drift without disturbing unrelated user work.
tags: [git, cleanup, maintenance]
---

Clean up the repository state.

Inspect git status, ignored/generated files, stale build artifacts, and package lock drift. Separate intended changes from unrelated or user-owned changes.

Do not revert unrelated work. If cleanup requires deleting files, confirm they are generated, temporary, or clearly part of the requested cleanup.

Prefer durable fixes:
- Update ignore rules when generated files keep reappearing.
- Update scripts when manual cleanup is repeatedly needed.
- Keep staged files limited to the intended change set.
