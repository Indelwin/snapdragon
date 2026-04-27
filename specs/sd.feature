Feature: sd batteries-included agent
  The batteries-included sd package should provide an ECS-driven TUI, a compact
  REPL mode, and one-shot prompts on top of the generic Snapdragon foundation.

  Scenario: sd can start from env-backed defaults
    Given no sd config file has been written
    When sd resolves its runtime configuration
    Then it should default to the Anthropic provider
    And it should use the claude-opus-4-7 model
    And it should read the Anthropic API key from ANTHROPIC_API_KEY

  Scenario: sd owns config discovery without storing secrets
    Given the user runs sd setup
    When sd writes its default YAML config and env template
    Then the config should contain provider preferences and env var names
    And it should not contain API key values

  Scenario: sd records portable sessions
    Given session persistence is enabled
    When the user sends prompts through sd
    Then sd should append user, assistant, tool, and multimodal content to JSONL
    And sd should create a fresh session unless a session id is supplied

  Scenario: sd resumes durable sessions
    Given a prior sd JSONL session exists
    When the user starts sd with resume enabled
    Then sd should preload the session messages into the agent
    And new user, assistant, and tool messages should append to the same JSONL file

  Scenario: sd lists and deletes sessions explicitly
    Given session persistence is enabled
    When the user lists or deletes sessions from the CLI or TUI
    Then sd should use the configured JSONL session root
    And it should reject deletion of the active session

  Scenario: sd exposes coding tools through the REPL
    Given file, shell, and repl toolsets are available
    When the user starts sd with the repl mode
    And the user runs the tools command
    Then sd should list only enabled toolsets and tools

  Scenario: sd applies profile overlays
    Given a profile directory contains profile.yaml and optional SOUL.md
    When the profile is selected by CLI, sticky default, or slash command
    Then sd should overlay model, agent, persona, and toolset values onto base config
    And CLI provider and model flags should still win over profile model fields

  Scenario: sd isolates profile homes
    Given a profile directory contains profile.yaml and optional SOUL.md
    When sd starts with that profile active
    Then sd should use the profile's sessions directory for JSONL sessions
    And sd should use the profile's skills directory as the writable skill root
    And unprofiled sessions and skills should not bleed into the active profile

  Scenario: sd indexes skills by descriptor before loading bodies
    Given a skill directory contains a SKILL.md file with YAML frontmatter
    When sd builds slash-command suggestions or skill search results
    Then sd should expose only the skill id, command, name, and description
    And it should not load the full skill body until the skill is invoked or read

  Scenario: sd invokes skills as one-request commands
    Given a code-review skill is available to the active profile
    When the user runs /code-review against a task
    Then sd should send the full skill body to the provider for that run
    And sd should persist only the visible command plus skill invocation metadata
    And later prompts should not include the full skill body unless invoked again

  Scenario: sd guards runtime transitions
    Given an agent run is active in the TUI
    When the user tries to switch profiles or sessions
    Then sd should reject the transition until the active run finishes

  Scenario: sd defaults to the ECS-driven TUI
    Given the user starts sd without a prompt or explicit mode
    When sd parses the command line
    Then it should select tui mode
    And the Ink renderer should render trusted components from UI ECS descriptors

  Scenario: sd keeps the REPL embeddable
    Given an embedding host imports sd without starting the CLI
    When it calls the exported REPL runner with a resolved runtime
    Then sd should run the readline REPL without requiring UI descriptors from the host

  Scenario: sd can attach an image to the next prompt
    Given a user attaches an image URL or local image file
    When the next prompt is submitted
    Then sd should pass a provider-neutral image content block to the agent
    And the pending attachment list should be cleared after that prompt
