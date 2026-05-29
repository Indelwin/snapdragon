# @snapdragon-ai/learn

Contracts and small local runners for Snapdragon learning jobs: datasets,
rollouts, rubrics, verifiers, evals, training backends, and Prime Intellect
adapter shapes.

The first runnable layer is local evals. `evaluateSource(...)` scores rollouts
from any `TaskSource` (dataset, live env, HTTP gym, procedural, mixed) against
a rubric, can run anti-gaming verifiers, and returns per-example rollout
results for debugging, replay, SFT filtering, and prompt optimisation.
`evaluateDataset(...)` is the back-compat wrapper for purely static datasets.
`learnJobToGatewayJob(...)` maps GEPA/SFT/RL/eval jobs onto the durable gateway
queue.

## TaskSource: live envs are first-class

Snapdragon does **not** require pregenerating a dataset to run RL, GEPA, or
evals. Everything that consumes tasks consumes a `TaskSource`, which is just
an async iterator over `TaskExample`s plus optional indexed access. Five
implementations ship in the box:

| Source | Use case | `size` | Indexed |
|---|---|---|---|
| `datasetTaskSource({ id, examples })` | Static benches, replay sets, SFT-filtered data | known | yes |
| `proceduralTaskSource({ id, generate })` | Pure `(seed) => TaskExample`. Unit tests, synthetic envs | unbounded | yes (by seed) |
| `processTaskSource({ id, command, args, env })` | Spawn an env binary, exchange NDJSON over stdio. Drives sd, sandboxed games (e.g. Nethack), local RPC envs | unbounded | no |
| `httpTaskSource({ id, url, auth? })` | POST a task request envelope, receive a `TaskExample`. Covers gym servers, in-game NPC RPCs, production replay shards, anything HTTP-reachable | optional | no |
| `mixedTaskSource({ id, sources })` | Weighted multiplexer over heterogeneous sources | bounded if all children bounded | no |

The same `TaskSource` flows unchanged into `evaluateSource(...)`, the upcoming
GEPA optimiser, SFT data generation, and the RL job runner — none of them
branch on source kind. `evaluateSource` requires an explicit `count` when the
source is streaming (`size === undefined`) so unbounded sources can't silently
loop.

`processTaskSource` and `httpTaskSource` are the universal bridges:

- **`processTaskSource`** — sd's default dogfood path. The child writes one
  `TaskExample` JSON object per line to stdout in response to a request line on
  stdin; the source streams those lazily and tears down on `signal.aborted`.
- **`httpTaskSource`** — POST `{ count, seed?, requestId }` to a configured
  URL; the server returns `{ tasks: TaskExample[] }`. Auth is a header
  callback so token rotation stays out of the source's internal state.

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
  progress events, and `continueOnError` support, accepting any `TaskSource`
  (datasets, live envs, HTTP, procedural, mixed).
- `TaskSource` abstraction plus dataset/procedural/process/http/mixed
  implementations.
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
