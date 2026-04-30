# Quality Gates

Snapdragon uses quality gates to guide agents toward maintainable changes.

## Daily Gates

- `npm run check:fast` runs linting, Gherkin validation, maintainability checks, baseline protection, and architecture checks.
- `npm run check:push` adds typechecking, quality script tests, Node-native coverage, changed-function CRAP, summary coupling/risk reports, and Rust tests.
- `npm run check:deep` reruns verbose coupling/risk reports plus mutation tests.

## Maintainability

`quality:maintainability` replaces the old CRAP proxy. It tracks broad file-level pressure: file length, cyclomatic-ish text complexity, exported symbol count, and largest function span. Existing debt is stored in `.quality/maintainability-baseline.json`.

Baseline entries may shrink normally. Baseline increases are blocked unless `SNAPDRAGON_ALLOW_QUALITY_BASELINE_INCREASE=1` is set after human approval.

## Coverage-Aware CRAP

`quality:crap` is the actual CRAP gate for changed TypeScript/JavaScript functions. It uses:

```text
CRAP = complexity^2 * (1 - coverage)^3 + complexity
```

Changed functions fail when the score is above 30. Add tests or reduce complexity before considering any baseline change.

## Static Analysis Reports

- `quality:architecture` blocks import cycles and package-boundary violations.
- `quality:reports` runs summary coupling and risk reports on every push.
- `quality:coupling -- --summary` reports the top 5 co-changing file pairs and churn hotspots.
- `quality:coupling -- --verbose` reports the top 25.
- `quality:risk -- --summary` reports the top 5 high-risk files by churn, complexity, and size.
- `quality:risk -- --verbose` reports the top 25.
