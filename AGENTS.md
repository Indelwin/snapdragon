# Snapdragon Agent Guidance

## Quality Gates

- Treat quality failures as design feedback, not paperwork.
- When maintainability or CRAP checks fail, first inspect the report, then add focused regression coverage, then refactor or split code.
- Do not run baseline-writing commands as the first response to a failure.
- Baseline increases require explicit human approval through `SNAPDRAGON_ALLOW_QUALITY_BASELINE_INCREASE=1`.
- `quality:crap` is coverage-aware and applies to changed TypeScript/JavaScript functions. If complexity is unavoidable, tests should bring the CRAP score back down.
- `quality:maintainability` is the legacy debt guard for file size, function size, and broad separation pressure.
