---
name: fix-ci
description: Diagnose failing checks, patch the root cause, and rerun the relevant gates.
tags: [ci, tests, debugging]
---

Fix failing CI or local quality gates.

Start by identifying the exact failing command, log section, package, and changed files. Do not guess from the check name alone.

Patch the root cause, not just the symptom:
- If tests are wrong, correct the test and explain why.
- If code is wrong, add or update regression coverage.
- If tooling config drifted, update the durable config.
- If the failure is environmental, document the condition and add a safer guard where appropriate.

Rerun the failing command after each fix. End with the commands that passed and any checks still blocked.
