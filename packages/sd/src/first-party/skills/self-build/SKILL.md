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

Use `sd gateway sandboxes lease <repo> --ref <path>` when a gateway worktree sandbox is available. Avoid changing global auth, HOME, or project config unless the user explicitly asks.

The repository-root `./sd` launcher is only a local dogfooding stopgap until Snapdragon is production-ready as a global install. If a push or gateway dogfood run says the launch script is missing, check for the root `sd` shell script before hunting deeper: it should exec `packages/sd/dist/cli.js`, preserve arguments, and give a clear build hint when `dist` is absent. Prefer `./sd ...` in this repo unless a global `sd` binary is explicitly installed.

Design changes so the worktree step can later be mounted into OpenShell, Docker, or another sandbox backend without changing the skill contract.
