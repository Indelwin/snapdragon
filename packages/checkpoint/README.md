# @snapdragon-ai/checkpoint

Filesystem checkpoints for agent tool calls.

A standalone package that lets an agent loop snapshot the project work tree
before any tool call that might mutate files, and roll back later — without
ever touching the user's real `.git` repository.

Modeled on the shadow-repo design used by `hermes-agent`.

## Why a separate package

- **Checkpoint** answers "can I undo what just happened?" — runs *after*
  potentially destructive tool calls (or just-before snapshot).
- **Sandbox** answers "should this be allowed to happen?" — runs *before*.

Different question, different timing, different failure modes (fail-quiet vs
fail-loud), different cost profile. They will share substrate (path-policy,
destructive-command heuristics) but neither should depend on the other.

## Surface

```ts
import { CheckpointManager } from '@snapdragon-ai/checkpoint';

const mgr = new CheckpointManager({
  enabled: true,
  baseDir: '/Users/alice/.snapdragon/checkpoints',
});

mgr.newTurn(); // call at the start of each agent turn

// Before a write_file / patch / destructive shell command:
await mgr.ensureCheckpointForPath('/work/project/src/foo.ts', 'before write_file');

// User-driven, typically wired to a `/rollback` slash command:
const entries = await mgr.listCheckpoints('/work/project');
const diff = await mgr.diffCheckpoint('/work/project', entries[0].hash);
const result = await mgr.restoreCheckpoint('/work/project', entries[0].hash, {
  file: 'src/foo.ts',          // single-file restore
  preRollbackSnapshot: true,   // record state *before* the rollback so it's
                               // also undoable (default true)
});
```

## What it actually does

For each work tree, the manager keeps a shadow git repo under
`<baseDir>/<sha256(absPath)[:16]>/` and points git at the work tree via
`GIT_DIR` + `GIT_WORK_TREE`. The user's real `.git` (if any) is never read or
written. `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null` keep
the shadow repo isolated from any global git hooks/config.

`ensureCheckpoint` dedups within a turn (call `newTurn()` to reset). When
nothing changed since the last commit, it's a no-op.

All git invocations have a per-call timeout (default 5s) and a hard exit-code
allowlist. Failures are routed through an optional `log` callback; the
manager itself never throws into the agent loop.

## Helpers exported

In addition to `CheckpointManager`:

- `isDestructiveCommand(cmd)` — heuristic ported from hermes' `_is_destructive_command`.
- `getWorkingDirForPath(path)` — walks up to a recognisable project root.
- Public types: `CheckpointEntry`, `CheckpointDiffResult`, `CheckpointRestoreResult`,
  `CheckpointManagerOptions`.

## Not included (intentionally)

- No CLI wiring or slash commands. Those live in `@snapdragon-ai/sd`.
- No tool-loop interception. The agent loop decides when to call
  `ensureCheckpointForPath` / `ensureCheckpoint`.
- No sandboxing. That's a sibling package.
