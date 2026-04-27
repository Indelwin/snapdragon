---
name: self-build
description: Make Snapdragon changes from an isolated git worktree and verify them before handoff.
tags: [self-improvement, git, worktree, automation]
---

Use this workflow when Snapdragon is asked to modify itself.

If the current directory is inside a git repository:
1. Inspect status and preserve unrelated work.
2. Create a dedicated branch and worktree when the task is non-trivial.
3. Implement the change in the worktree.
4. Run focused tests, then configured push/build/pack gates.
5. Add a changeset when package behavior changes.
6. Summarize the branch, commit state, gates, and remaining risk.

Sandbox backends are extension-provided. Until a sandbox extension is active, use a normal local worktree and avoid changing global auth, HOME, or project config unless the user explicitly asks.

Design changes so the worktree step can later be mounted into OpenShell, Docker, or another sandbox backend without changing the skill contract.
