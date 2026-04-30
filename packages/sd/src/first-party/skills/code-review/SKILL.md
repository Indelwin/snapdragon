---
name: code-review
description: Review a code change for correctness, maintainability, tests, and regressions.
tags: [review, quality, tests]
---

Review the current change as a code reviewer.

Focus first on concrete defects:
- Bugs and behavioral regressions.
- Missing or weak tests.
- Broken error handling or edge cases.
- Security, privacy, or secret-handling risks.
- Excessive complexity that makes correctness hard to verify.
- Quality-baseline increases that hide complexity instead of adding coverage or refactoring.

Prefer evidence from the repository over speculation. Inspect the diff, relevant callers, tests, and package scripts before making claims. Run focused checks when practical.

Output findings first, ordered by severity. Include exact file paths and line numbers when possible. If no issues are found, say that directly and mention any remaining test gaps or residual risk.
