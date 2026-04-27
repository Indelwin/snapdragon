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
