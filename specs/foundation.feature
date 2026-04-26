Feature: Snapdragon TypeScript foundation
  Generic packages should support agent implementations without forcing a
  specific UI, config loader, or session backend.

  Scenario: Providers receive portable multimodal messages
    Given a provider-neutral user message with text and image blocks
    When the Anthropic, OpenAI Responses, and OpenAI-compatible adapters build requests
    Then each request should use the provider's native image input shape
    And the original Snapdragon message should remain provider-neutral

  Scenario: Sessions preserve multimodal agent history
    Given an append-only JSONL session
    When an agent stores user, assistant, tool, and metadata records
    Then reopening the session should recover the same ordered messages
    And malformed trailing JSONL should not hide valid earlier records

  Scenario: Generic config stays resolved and side-effect free
    Given a runtime-specific agent has already discovered files, env vars, and tokens
    When it builds a Snapdragon config contract
    Then the generic config package should only normalize resolved values
    And it should not read local files or environment variables

  Scenario: Toolsets can be filtered independently
    Given file, shell, and REPL toolsets are registered
    When runtime config disables shell or denies a single tool
    Then the registry should expose only the remaining enabled tool definitions
