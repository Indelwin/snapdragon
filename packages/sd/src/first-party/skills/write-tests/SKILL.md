---
name: write-tests
description: Add focused tests for changed behavior, edge cases, and regressions.
tags: [tests, tdd, coverage]
---

Add tests before or alongside implementation changes.

When a quality gate reports high CRAP, use tests to lower the coverage-aware score where the complexity is legitimate. If the code is hard to test, call out the design pressure and refactor before adding broad or brittle coverage.

Prefer tests that prove externally visible behavior:
- Public APIs, CLI behavior, serialized data, and provider/tool contracts.
- Regressions that would have failed before the fix.
- Edge cases around invalid input, disabled features, and persistence.

Avoid brittle tests that duplicate implementation details. Use fixtures for provider streams and filesystem state when live network calls would make the test unstable.

Run the focused package tests after writing them. If a broader gate is available and cheap, run it too.
