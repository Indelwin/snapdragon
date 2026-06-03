# @snapdragon-ai/sd

Batteries-included Snapdragon code agent CLI.

`sd` currently ships a minimal ECS-driven Ink TUI plus a readline REPL mode
that exercises the shared foundation packages: providers, sessions, toolsets,
streaming events, and multimodal image input.

```sh
sd --setup
sd
sd --resume
sd --profile daily
sd --repl
sd "list the files in this workspace"
```

Default config lives at `~/.snapdragon/sd/config.yaml`. General environment
variables can live in `~/.snapdragon/.env`; `sd` loads that file without
overriding exported variables. The default provider is Anthropic with
`claude-opus-4-7` and `ANTHROPIC_API_KEY`.

Sessions are portable JSONL files under `~/.snapdragon/sd/sessions` by
default. Profiles live under `~/.snapdragon/sd/profiles/<name>/` with a
required `profile.yaml`, optional `SOUL.md`, profile-local sessions, skills,
memory, extensions, workspace, logs, and home directories.

Skills are descriptor-first `SKILL.md` directories. `sd --setup` installs
first-party skills such as `code-review`, `fix-ci`, `write-tests`,
`release-check`, `repo-cleanup`, `self-build`, and `skill-learner`.

Memory uses an active provider contract. The default `sd` provider is a
profile-local or global `MEMORY.md` file that can be read, searched, appended
by tools, and auto-captured from stable user preferences.

## Gateway and Background Services

`sd` uses the Snapdragon gateway for background work. The default runtime is
the Rust daemon; `inline-ts` remains available for tests and very small embedded
hosts.

```sh
sd gateway start
sd gateway status
sd gateway restart
sd gateway stop
sd gateway ps
sd gateway services list
sd gateway services run memory-worker
sd gateway services enable channel-events
sd gateway services disable skill-builder
sd gateway channels list
sd gateway channels ensure local:demo
sd gateway channels show local:demo
sd gateway events enqueue local:demo "run the next queued task"
sd gateway events list
sd gateway events cancel 20260506_event
sd gateway jobs enqueue agent.run '{"prompt":"check the repo"}'
sd gateway jobs list
sd gateway jobs delete <job_id>
sd gateway jobs retry <job_id>
sd gateway agents enqueue "run the release checks"
sd gateway agents register-pi
sd gateway agents register-pi --save --agent-dir ~/.pi-agent
sd gateway agents list
sd gateway agents unregister pi
sd gateway agents enqueue --runtime pi "ask my Pi agent to triage the workspace"
sd gateway agents run "summarize the current workspace"
sd gateway workers register pi-worker-1 --runtime pi --capability agent.run --status ready
sd gateway workers heartbeat pi-worker-1 --state idle --status "waiting for work"
sd gateway workers list
sd gateway workers show pi-worker-1
sd gateway workers unregister pi-worker-1
sd gateway rest serve --start --port 8787
sd gateway learn enqueue-eval ./eval-dataset.json
sd gateway logs tail
sd gateway sandboxes lease . --ref ../reference-repo --ttl-ms 3600000
sd gateway sandboxes list
sd gateway registry list
sd gateway tables list
```

Configured services are in `gateway.services`; background channel settings are
in `background.channels`. First-party services currently include
`memory-worker`, `skill-builder`, `channel-events`, `session-index`, and
`agent-jobs`; `learn-jobs` is available but disabled by default. Service config supports `restart`, `restart_intensity`,
`backoff_ms`, and `max_backoff_ms`; `sd gateway status` reports suppressed
restarts, next scheduled runs, queue depth, active leases, and recent failures.

When the Rust runtime is active, services are executed through an internal
headless worker command. The worker rebuilds only the runtime pieces a service
needs: config, profile overlays, extensions, skills, memory, todos, channels,
and the optional one-shot background chat helper. It does not load the Ink TUI
or run the interactive `sd` controller.

The Rust daemon stores durable jobs, events, service snapshots, leases, and logs
in a SQLite WAL database under the gateway root. It also stores durable worker
records, heartbeats, and current lease metadata so runtime adapters are
inspectable even when the TUI is not running. Agent jobs use the same headless
runtime as service workers, so scheduled channel work can use tools, sessions,
skills, memory, and TODOs without starting Ink.

Gateway jobs are attempt-aware. Worker failures and expired leases requeue work
while attempts remain; exhausted jobs become `failed` and can be put back on the
queue with `sd gateway jobs retry <job_id>`. Cancellation stays terminal so a
cancelled job is never resurrected by retry or by late worker completion. The
`delete` and `remove` aliases also cancel jobs, matching the REST `DELETE`
resource semantics used by management clients.

`sd gateway workers` manages durable worker entities. Use `register` and
`heartbeat` when an external runtime wants to announce itself, attach capability
or runtime metadata, and keep its current state inspectable. `list` and `show`
display the worker queue, state, status, current job, and current lease.
`unregister` removes stale or retired worker records from the management
surface without deleting job or log history. The singular `sd gateway worker`
command remains the internal headless service worker runner used by the Rust
daemon.

`sd gateway rest serve` starts a foreground local REST/SSE facade over the
gateway client. By default it binds `127.0.0.1:8787` with `/v1` routes; use
`--port`, `--host`, `--prefix`, `--stream-ms`, and `--stream-heartbeat-ms` to
tune it. It refuses
non-loopback hosts unless `--allow-remote` is passed, keeping auth-less preview
servers local by default. Add `--start` to start the Rust gateway daemon first.

Agent jobs can also target external runtimes. `sd gateway agents register-pi`
adds a Pi JSONL runtime descriptor for the installed `pi` command; adding
`--save` persists the descriptor in `gateway.agent_runtimes` so future daemon
starts and job workers can rehydrate it without another manual registration.
`sd gateway agents enqueue --runtime pi "..."` then routes the job through Pi's
RPC mode, preserving the user's Pi configuration, extensions, skills, sessions,
and provider credentials. `sd gateway agents list` and `show` include saved
runtimes even when the daemon is unavailable, which keeps the management surface
inspectable before background services are running.
`sd gateway agents unregister <runtime-id>` removes a retired live runtime from
the gateway and durable store; saved config entries remain explicit userland
configuration and are not edited implicitly.

While a Pi job runs, the `agent-jobs` worker mirrors selected Pi lifecycle
events into gateway logs targeted at the job id. `sd gateway logs tail <job_id>`
shows runtime start, `agent_start`, `message_end`, tool execution boundaries,
extension UI requests, and cancellation observation without dumping every token
delta. `sd gateway agents cancel <job_id>` marks the durable job cancelled; the
worker observes that state, aborts the Pi RPC run, clears the lease, and leaves
late worker completion/failure writes as no-ops against the cancelled job.

Learning eval jobs are gateway jobs on the `learn` queue. The first built-in
runner is deliberately local and simple: `learn-jobs` consumes `learn.eval`
payloads with inline datasets and scores rollout metadata through the
anti-gaming rubric. GEPA/SFT/RL backends can build on that durable job shape.

Channel homes live under the configured gateway channel root and contain
sessions, skills, workspace, logs, and home directories for future stronger
isolation. Authentication inheritance is still the default unless profile or
config policy changes it.

The built-in sandbox backend is local `git worktree` isolation. Leases record
the project root, branch, backend, TTL, and optional reference roots; references
are linked under `.snapdragon/references/` in the worktree. When the Rust
gateway daemon is available, `sd gateway sandboxes lease` also records the lease
in the durable gateway registry, and `release`/`destroy` release it there as
well. The file-backed lease remains the fallback source of truth when the daemon
is offline. OpenShell, Docker, microVM, and remote backends are expected to plug
into the same sandbox lease contract later.

Interactive commands:

```text
/help
/quit
/clear
/session
/sessions
/resume [id]
/new-session [id]
/delete-session <id>
/profiles
/profile [name|none]
/memory [query]
/remember <note>
/extensions
/tools
/provider
/models
/model
/attach <path-or-url>
/clear-attachments
```
