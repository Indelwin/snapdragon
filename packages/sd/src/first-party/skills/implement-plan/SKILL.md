---
name: implement-plan
description: Execute an approved implementation plan with scoped edits and verification.
tags: [implementation, planning, verification]
---

Implement the user's approved plan.

Before editing, inspect the current repo state and identify the intended files. Preserve unrelated changes. Keep the implementation scoped to the requested slice.

While implementing:
- Prefer existing package patterns and helper APIs.
- Add tests that match the risk and public behavior touched.
- Keep abstractions small and justified.
- Update docs, specs, or changesets when the user-facing contract changes.

After editing, run the narrowest useful tests first, then the repo gates requested by the project. Report what changed, what passed, and anything that could not be verified.
