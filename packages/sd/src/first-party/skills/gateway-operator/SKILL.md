---
name: gateway-operator
description: Operate the Snapdragon background gateway, daemon, and service status loop safely.
tags: [gateway, daemon, background, operations]
---

Use this skill when asked to inspect, start, stop, or debug Snapdragon background work.

The gateway is the background services host. In normal interactive `sd` runs it is daemon-backed by default; `--background inline` keeps services in-process for focused debugging, and `--background off` disables them.

Useful commands:
- `sd daemon status` shows whether the daemon is alive, the daemon root, service run/error counts, and channel root/count.
- `sd daemon start` starts the daemon using the resolved `sd` config.
- `sd daemon stop` stops the daemon.
- `sd daemon run-once` runs each configured service once in a short-lived runtime.
- `sd --background inline ...` is best for reproducing a service bug locally.
- `sd --no-background ...` is best when foreground agent behavior must be isolated.

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
