# @snapdragon-ai/learn

Contracts and small local runners for Snapdragon learning jobs: datasets,
rollouts, rubrics, verifiers, evals, training backends, and Prime Intellect
adapter shapes.

The first runnable layer is local evals. `evaluateDataset(...)` scores rollouts
with a rubric, can run anti-gaming verifiers, and returns per-example rollout
results for debugging, replay, SFT filtering, and prompt optimisation.
`learnJobToGatewayJob(...)` maps GEPA/SFT/RL/eval jobs onto the durable gateway
queue.

Prime Intellect remains an adapter target, not the learning abstraction. The
package includes Prime-shaped config contracts for Hosted Training environments
without requiring the Prime CLI or Python SDK at runtime.

## Current pieces

- Dataset/example contracts with optional environment, verification, expected
  tool-call/output evidence, and tool budget metadata.
- Rollout traces with messages, tool call traces, token usage, and arbitrary
  metadata.
- Rubric contracts and `antiGamingRubric()` based on tool-use, tool-outcome,
  efficiency, and duplicate-call signals.
- Verifier contracts plus initial anti-gaming/evidence helpers:
  - `requiredToolUseVerifier()`
  - `requiredToolsVerifier()`
  - `forbiddenToolsVerifier()`
  - `expectedToolCallsVerifier()`
  - `toolSuccessVerifier()`
  - `maxToolCallsVerifier()`
  - `noConsecutiveDuplicateToolsVerifier()`
  - `noRepeatedFailedToolCallsVerifier()`
  - `minimumOutputVerifier()`
  - `outputContainsVerifier()`
  - `nonEmptyToolOutputVerifier()`
  - `createAntiGamingVerifiers()`
- Verifier summaries with all-pass and weighted aggregation modes.
- Local eval runner with optional verifier execution, per-example results,
  progress events, and `continueOnError` support.
- Provider-independent environment/sandbox contracts.
- `createPrimeTrainingConfig(...)` and `primeBackend` for Prime Hosted Training
  config objects.

## Prime adapter direction

Prime environments are Python `verifiers` packages exposing
`load_environment(...)`. Snapdragon keeps that as an adapter boundary. Local
Snapdragon rollouts/rubrics/verifiers should be reusable for:

- local evals;
- Prime hosted evals;
- Prime RL training;
- GEPA prompt optimisation;
- SFT data generation.

See `docs/learn-prime-intellect-plan.md` for the broader integration plan.
