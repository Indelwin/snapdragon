import { DEFAULT_SD_CONFIG_PATH, DEFAULT_SD_ENV_PATH } from './config.js';

export const helpText = `sd

Batteries-included Snapdragon code agent.

Usage:
  sd [options]
  sd repl [options]
  sd tui [options]
  sd daemon [run|start|stop|status|run-once] [options]
  sd gateway <command> [options]
  sd [options] "prompt"

Gateway commands:
  sd gateway inspect [job-id] [--runtime <id>] [--worker <id>] [--limit <n>]
  sd gateway jobs enqueue|list|show|cancel
  sd gateway agents list|show|register-pi|probe-pi
  sd gateway agents run|enqueue [--runtime <id>]
  sd gateway agents status|cancel <job-id>
  sd gateway learn enqueue-eval <dataset.json> [--id <id>]
  sd gateway logs tail [target] [limit]
  sd gateway sandboxes list
  sd gateway sandboxes lease [project] [--id <id>] [--ref <path>] [--ttl-ms <ms>]
  sd gateway sandboxes release|destroy <lease-id>

Options:
  --mode <mode>        Run mode (tui|repl|print)
  --repl               Start the readline REPL
  --tui                Start the Ink TUI
  --print              Print one-shot output for a prompt
  --provider <name>    Provider override (anthropic|openai|openai-compatible|mock)
  --model <id>         Model override
  --cwd <path>         Workspace root for coding tools
  --config <path>      Config file path
  --background <mode>  Background mode (daemon|inline|off)
  --no-background      Disable background services for this run
  --session <id>       Resume or create a named session
  --resume             Resume --session <id> or the most recent session
  --list-sessions      Print persisted sessions and exit
  --delete-session <id> Delete a persisted session and exit
  --new-session        Force a new session
  --no-session         Disable session persistence
  --profile <name>     Load a profile overlay
  --no-profile         Ignore sticky/default profile
  --list-profiles      Print available profiles and exit
  --setup              Create default config and env template if missing
  -v, --version        Print version
  -h, --help           Print help

Defaults:
  config: ${DEFAULT_SD_CONFIG_PATH}
  env:    ${DEFAULT_SD_ENV_PATH}
`;
