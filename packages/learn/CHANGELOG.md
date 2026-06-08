# @snapdragon-ai/learn

## 0.2.0

### Minor Changes

- e68b65b: Add `TaskSource` abstraction with four implementations (dataset, procedural,
  HTTP, process) and a `mixedTaskSource` combiner — live environments are now
  first-class peers of static datasets.

  Add `evaluateSource(...)` (the new core eval entry point) alongside the
  existing `evaluateDataset(...)` wrapper.

  Add the GEPA mutation-only optimiser: target descriptors, pluggable adapter
  (`GepaAdapter`), Pareto-front selection with bandit parent sampling, and the
  `optimizeGepa(...)` main loop. Returns a `GepaReport` with best candidate,
  Pareto front, full history, and event log. Merge/crossover and feedback
  memory are intentionally deferred.
