# @snapdragon-ai/sd

Batteries-included Snapdragon code agent CLI.

`sd` currently ships a minimal coding REPL that exercises the shared
foundation packages: providers, sessions, toolsets, streaming events, and
multimodal image input.

```sh
sd --setup
sd
sd "list the files in this workspace"
```

Default config lives at `~/.snapdragon/sd/config.yaml`. General environment
variables can live in `~/.snapdragon/.env`; `sd` loads that file without
overriding exported variables. The default provider is Anthropic with
`claude-opus-4-7` and `ANTHROPIC_API_KEY`.

Interactive commands:

```text
/help
/quit
/clear
/session
/tools
/provider
/attach <path-or-url>
/clear-attachments
```
