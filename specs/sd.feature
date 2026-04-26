Feature: sd minimal REPL agent
  The batteries-included sd package should provide a compact coding REPL on
  top of the generic Snapdragon foundation.

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

  Scenario: sd exposes coding tools through the REPL
    Given file, shell, and repl toolsets are available
    When the user runs the tools command
    Then sd should list only enabled toolsets and tools

  Scenario: sd can attach an image to the next prompt
    Given a user attaches an image URL or local image file
    When the next prompt is submitted
    Then sd should pass a provider-neutral image content block to the agent
    And the pending attachment list should be cleared after that prompt
