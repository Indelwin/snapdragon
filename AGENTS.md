# Snapdragon Agent Guidance

## Pull Requests

- Use branch names following the `feature/<feature>` convention.
- Use one PR against updated `main` for a coherent user-requested change. Do not split it into stacked PRs unless the user explicitly requests that workflow.
- Integrate concurrent implementation slices and resolve conflicts before handing the PR back. The user should not have to manage branch retargeting or integration conflicts.

## Privacy

- Treat this as a pseudonymous project. Do not include personal names, email addresses, or home-directory paths in commits, documentation, or repository metadata.

## Quality Gates

- Treat quality failures as design feedback, not paperwork.
- When maintainability or CRAP checks fail, first inspect the report, then add focused regression coverage, then refactor or split code.
- Do not run baseline-writing commands as the first response to a failure.
- Baseline increases require explicit human approval through `SNAPDRAGON_ALLOW_QUALITY_BASELINE_INCREASE=1`.
- `quality:crap` is coverage-aware and applies to changed TypeScript/JavaScript functions. If complexity is unavoidable, tests should bring the CRAP score back down.
- `quality:maintainability` is the legacy debt guard for file size, function size, and broad separation pressure.
