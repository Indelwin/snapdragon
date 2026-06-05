---
name: gateway-operator
description: Operate the Snapdragon background gateway, daemon, and service status loop safely.
tags: [gateway, daemon, background, operations]
---

Use this skill when asked to inspect, start, stop, or debug Snapdragon background work.

The gateway is the background services host. In normal interactive `sd` runs it is daemon-backed by default; `--background inline` keeps services in-process for focused debugging, and `--background off` disables them.

Useful commands:
- `sd gateway status` shows Rust gateway daemon status, socket/store paths, worker state, service counters, and queue depth.
- `sd gateway inspect [job-id] [--runtime <id>] [--worker <id>] [--limit <n>]`
  shows a focused world snapshot with jobs, workers, runtimes, services, leases,
  sandboxes, and recent logs.
- `sd gateway daemon start|stop|run-once` controls the Rust gateway daemon explicitly.
- `sd gateway jobs enqueue|list|show|acquire|complete|fail|cancel|retry`
  exercises the durable job queue and worker lease lifecycle.
- `sd gateway logs append <job-id> <message> [--level <level>]` records
  job-targeted progress that `inspect` and `logs tail` can show.
- `sd gateway sandboxes lease|list|release` exercises gateway-managed worktrees for isolated repo work.
- Legacy `sd daemon status|start|stop|run-once` commands still cover the older daemon path where configured.
- `sd --background inline ...` is best for reproducing a service bug locally.
- `sd --no-background ...` is best when foreground agent behavior must be isolated.

Inside the Snapdragon repo, use `./sd ...` unless a global binary is known to be installed. The root launcher is a temporary dogfooding convenience and should not be treated as the production install path.

Useful files:
- Daemon root defaults to `~/.snapdragon/sd/daemon`.
- `daemon.pid` records the active process id.
- `status.json` is the latest heartbeat and service status snapshot.
- `daemon.log` contains daemon stdout/stderr.
- `channels/` contains gateway channel homes.

When debugging the gateway:
1. Check foreground mode and whether the daemon is enabled in config.
2. Read `sd daemon status` before assuming the daemon is running.
3. Inspect `status.json` and `daemon.log` if service counters stop moving.
4. Use `sd daemon run-once` for deterministic one-pass checks.
5. Keep background service changes idempotent; repeated ticks must not corrupt state.

Do not store API keys in daemon config, channel metadata, skills, logs, or session metadata. Use inherited environment or configured env-var names.
