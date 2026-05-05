---
name: channel-runs
description: Design channel-scoped agent runs for scheduled, gateway-addressed, or external-triggered work.
tags: [channels, scheduling, gateway, automation]
---

Use this skill when planning or implementing scheduled agent runs, external gateway triggers, or channel-scoped automation.

A Snapdragon gateway channel is a durable target named as `platform:id`, for example `local:nightly-quality`, `github:Indelwin/snapdragon`, `discord:123456`, or `slack:C1234`. If the platform is omitted, `local` is assumed.

Channel homes live under the configured background channel root, which defaults to `~/.snapdragon/sd/daemon/channels`. Each channel has:
- `channel.json` for descriptor metadata.
- `sessions/` for channel-local conversations.
- `skills/` for channel-local skills.
- `workspace/` for channel-local scratch files.
- `home/` for future process isolation.
- `logs/` and `log.jsonl` for append-only channel events.

Scheduled event files live under the configured event root, which defaults to `~/.snapdragon/sd/daemon/events`. Use `pending/` for new events; the daemon moves due files through `running/`, then `done/` or `failed/`. A minimal event looks like:

```json
{
  "type": "one-shot",
  "channel": "local:nightly-quality",
  "prompt": "Run the nightly quality summary.",
  "at": "2026-05-05T10:00:00.000Z"
}
```

Supported event types:
- `immediate`: due as soon as the gateway scans it.
- `one-shot`: due when `at` is in the past.
- `periodic`: due when `next_at` is in the past, then requeued by `interval_ms`.

When designing a scheduled run:
1. Choose a stable channel target before writing state.
2. Keep channel-local skills and session history inside that channel home.
3. Put shared instructions in a reusable skill only when multiple channels need them.
4. Append trigger and completion summaries to `log.jsonl`.
5. Keep event payloads small; store large outputs in files and reference paths.

The first scheduler runs through the daemon background chat path and records Markdown output in the channel `logs/` directory. Full tool-using foreground-equivalent agents should be a later gateway service that starts a channel-scoped session and runs the normal agent loop.

Do not silently mix global profile state into a channel run. Inherit auth by default unless config explicitly requests isolation, but keep logs, scratch files, skills, and sessions channel-local.
