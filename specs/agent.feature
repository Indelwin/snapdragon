Feature: Snapdragon coding agent
  The default agent should expose a practical coding surface without hiding
  programmatic tool use behind UI-only behavior.

  Scenario: The agent can use the REPL to inspect its tools
    Given a Snapdragon coding REPL agent with the mock provider
    When the model calls the "repl_eval" tool to list registered tools
    Then the run should continue after the tool result
    And the tool result should include "repl_eval"
