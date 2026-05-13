# Snapdragon Learn + Prime Intellect Integration Plan

Status: planning notes from investigation with `curl` against Prime Intellect docs and a local clone of `git@github.com:Indelwin/pi-agent-rl-toolkit.git` in `.external/pi-agent-rl-toolkit`.

## Goals

`@snapdragon-ai/learn` should become the provider-independent learning layer for Snapdragon agents while using Prime Intellect as the first serious backend target.

The same stack should support:

- local and hosted evaluations;
- RL training on Prime Intellect Lab / Hosted Training;
- environment packaging and upload to Prime Environments Hub;
- rubric and verifier reuse across evals, RL, GEPA prompt optimisation, and SFT data generation;
- artifact and rollout capture for debugging, replay, and SFT datasets;
- sandbox-backed and browser-backed environments;
- future web/browsing tools via a separate `webtools` package.

Core rule:

> Prime Intellect is an adapter target, not the core abstraction.

Second core rule (added once we started building):

> Datasets are one shape of task source, not the abstraction. Live envs are
> first-class. RL, GEPA, evals, and SFT generation all consume a `TaskSource`
> — datasets, procedural generators, child-process envs, and HTTP gym envs
> are all peers, and none of them require pregenerating gigabytes of replay.
> See `packages/learn/README.md` ("TaskSource") for the surface; the dataset
> path is the back-compat wrapper around `datasetTaskSource(...)`.

## Prime Intellect concepts to model

Prime's docs describe an RL training run as three decoupled components:

1. **Inference**: generates model completions turn-by-turn, usually via vLLM or Prime Inference.
2. **Orchestrator**: samples environment prompts, drives rollouts, executes environment/tool logic between model turns, scores completed rollouts with rubrics, batches data, and coordinates updates.
3. **Trainer**: receives scored rollouts and trains with GRPO.

The environment is the user-authored boundary. It packages:

- a dataset of prompts and metadata;
- a harness, such as single-turn, multi-turn, tool, stateful tool, sandbox, or browser;
- a rubric/reward suite that emits scalar reward and metrics.

Prime environments are Python packages exposing `load_environment(...)` and are distributed as versioned wheels through the Environments Hub.

Prime's environment type hierarchy, via `verifiers`, matters for Snapdragon mapping:

- `SingleTurnEnv`: prompt -> completion -> reward.
- `MultiTurnEnv`: conversational rollout loop with `env_response(messages, state)` and stop conditions.
- `ToolEnv`: OpenAI-compatible tool/function calling using Python functions.
- `StatefulToolEnv`: tool calls with per-rollout state injected into hidden args.
- `SandboxEnv` / `PythonEnv` / `CliAgentEnv`: sandbox-backed stateful environments.
- `BrowserEnv`: browser automation, currently documented around Browserbase; Snapdragon should eventually adapt this to Camofox/webtools where appropriate.
- `EnvGroup`: combines heterogeneous environments for multi-task eval/training.

Prime uses the same environment abstraction for:

- RL training;
- standalone local evals (`prime eval run`);
- hosted evals (`prime eval run --hosted`);
- synthetic data generation;
- GEPA-style prompt optimisation configs.

## Hosted Training config shape

Prime Hosted Training is TOML configured. The key fields observed in docs and `pi-agent-rl-toolkit` are:

```toml
model = "Qwen/Qwen3-30B-A3B-Instruct-2507"
max_steps = 1000
batch_size = 256
rollouts_per_example = 8
# learning_rate = 1e-4
# lora_alpha = 16
# oversampling_factor = 2.0
# max_async_level = 2
# trajectory_strategy = "interleaved" # or "branching"
# checkpoint_id = "..."
env_file = ["../../secrets.env"]

[sampling]
max_tokens = 4096
# enable_thinking = false
# reasoning_effort = "high"

[[env]]
id = "owner/environment"
args = { max_turns = 10 }

[checkpoints]
interval = 50
# keep_cloud = 5 # -1 = keep all

[adapters]
# interval = 0
# keep_last = 3

[eval]
interval = 100
num_examples = -1
rollouts_per_example = 1
eval_base_model = true

[[eval.env]]
id = "owner/environment"
args = { split = "test" }
num_examples = 50
rollouts_per_example = 4

[val]
num_examples = 64
rollouts_per_example = 1
interval = 10

[buffer]
online_difficulty_filtering = true
# easy_threshold = 0.8
# hard_threshold = 0.2
# easy_fraction = 0.0
# hard_fraction = 0.0
# env_ratios = [0.5, 0.5]
# seed = 42

[wandb]
# project = "..."
# name = "..."
# entity = "..."

[infrastructure]
# compute_size = "M" # S, M, L
```

`@snapdragon-ai/learn` should be able to create this TOML-compatible shape from provider-independent contracts.

## Prime CLI/API surfaces to account for

From docs and OpenAPI discovery:

### CLI

- `uv tool install prime`
- `prime login`
- `prime lab setup`
- `prime env init <name>`
- `prime env install owner/env[@version]`
- `prime env push [--team <team>] [--visibility=PRIVATE] [--auto-bump]`
- `prime env list --owner primeintellect`
- `prime eval run owner/env -m <model> -n <num> -r <rollouts>`
- `prime eval run owner/env --hosted --follow`
- `prime eval tui`
- `prime inference models`
- `prime rl run configs/rl/foo.toml`
- training/checkpoint/model commands still need deeper CLI verification before coding wrappers.

### API endpoints

OpenAPI lists useful path families:

- `/api/v1/evaluations/`: create/list/update/get/delete/finalize evaluations.
- `/api/v1/evaluations/{evaluation_id}/samples`: push/get eval samples.
- `/api/v1/hosted-evaluations`: create hosted evaluations.
- `/api/v1/hosted-evaluations/{evaluation_id}/logs`: stream/get hosted eval logs.
- `/api/v1/hosted-evaluations/{evaluation_id}/cancel`: cancel hosted eval.
- `/api/v1/hosted-evaluations/models`: inference models for hosted evals.
- `/api/v1/training/runs`: create training runs.
- `/api/v1/training/runs/{run_id}`: delete training run.
- `/api/v1/sandbox`: create/list/delete sandboxes.
- `/api/v1/sandbox/{sandbox_id}/auth`: auth token for direct sandbox access.
- `/api/v1/sandbox/{sandbox_id}/logs`: sandbox logs.
- `/api/v1/sandbox/{sandbox_id}/expose`: expose/list ports.
- `/api/v1/sandbox/{sandbox_id}/ssh-session`: SSH sidecar sessions.

Submission/status/cancel/fetch-artifact adapters should be optional until we decide whether to shell out to Prime CLI, call API directly, or use Prime's Python SDK.

## Lessons from `pi-agent-rl-toolkit`

The toolkit is a concrete Prime/Verifiers environment for training tool-use coding agents. It contains:

- `configs/rl/*.toml`: hosted training configs.
- `configs/eval/*.toml`: local/hosted eval configs.
- `configs/gepa/*.toml`: GEPA config examples.
- `environments/pi_agent_env`: a Python `verifiers` `ToolEnv` package.
- `.prime/lab.json`: lab workspace metadata.

The environment uses six tools:

- `bash(command)`
- `read(path)`
- `write(path, content)`
- `python(code)`
- `find(pattern, path)`
- `grep(pattern, path, include)`

It has 598 tasks across seven categories:

- `zero_tool`
- `code_execution`
- `terminal`
- `file_ops`
- `self_improvement`
- `planning`
- `multi_step`

Important task metadata:

- `requires_tool: boolean`
- `max_tool_calls: number`
- `verify` object with task-specific expected checks

The rubric has five dimensions:

| Signal | Weight | Type | Purpose |
|---|---:|---|---|
| `task_completion` | 0.35 | LLM judge | Did the agent complete the task? |
| `tool_use_required` | 0.20 | programmatic | Hard guardrail against skipping required tools |
| `tool_outcomes` | 0.20 | programmatic | Did called tools succeed? |
| `efficiency` | 0.10 | programmatic | Stay within a tool-call budget |
| `dummy_call_detection` | 0.15 | programmatic | Detect redundant/wasted/ignored tool calls |

Key anti-gaming finding:

- A judge-only or judge-heavy reward can be gamed by confident text answers without tool use.
- Tool call metrics must be tracked beside reward.
- Required-tool guardrails prevented collapse of tool calls in the 1000-step run.

This strongly supports making verifiers and anti-gaming checks first-class in `@snapdragon-ai/learn`.

## Snapdragon type model to add

### Environment contracts

Add environment references separate from datasets:

```ts
export type LearnEnvironmentKind =
  | 'local'
  | 'prime'
  | 'sandbox'
  | 'browser'
  | 'gateway'
  | 'external';

export interface LearnEnvironment {
  id: string;
  kind: LearnEnvironmentKind;
  name?: string;
  description?: string;
  args?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SandboxSpec {
  image?: string;
  startCommand?: string;
  cwd?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  labels?: string[];
  timeoutMinutes?: number;
  cpuCores?: number;
  memoryGb?: number;
  diskSizeGb?: number;
  gpuCount?: number;
  network?: 'disabled' | 'restricted' | 'enabled';
  exposedPorts?: Array<{ port: number; protocol?: 'HTTP' | 'TCP'; name?: string }>;
}
```

Extend datasets/examples:

```ts
export interface TaskExample {
  id: string;
  prompt: string;
  category?: string;
  requiresTools?: boolean;
  maxToolCalls?: number;
  environment?: string;
  verify?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LearningDataset {
  id: string;
  examples: TaskExample[];
  environments?: LearnEnvironment[];
  metadata?: Record<string, unknown>;
}
```

### Rollout trace contracts

Need rich traces for eval debugging, SFT, GEPA, and reward hacking detection:

```ts
export interface RolloutMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolTraceStep {
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  success: boolean;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface RolloutTrace {
  id?: string;
  exampleId: string;
  output: string;
  messages?: RolloutMessage[];
  toolCalls: ToolTraceStep[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  tokenUsage?: TokenUsage;
  metadata?: Record<string, unknown>;
}
```

### Verifier contracts

Verifiers are harder gates than rubrics and should be reusable for evals, RL reward shaping, GEPA selection, and SFT filtering.

```ts
export type VerifierSeverity = 'info' | 'warning' | 'error';

export interface VerifierIssue {
  id: string;
  severity: VerifierSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface VerifierResult {
  verifierId: string;
  passed: boolean;
  score?: number;
  issues: VerifierIssue[];
  metadata?: Record<string, unknown>;
}

export interface Verifier {
  id: string;
  verify(example: TaskExample, rollout: RolloutTrace): VerifierResult | Promise<VerifierResult>;
}
```

Initial verifier helpers:

- `requiredToolUseVerifier()`
- `toolSuccessVerifier()`
- `maxToolCallsVerifier()`
- `noConsecutiveDuplicateToolsVerifier()`
- `noRepeatedFailedToolCallsVerifier()`
- `minimumOutputVerifier()`
- `requiredAnswerContainsVerifier()`
- `forbiddenToolVerifier()`

### Eval result contracts

`evaluateDataset(...)` should preserve per-example results:

```ts
export interface ExampleEvalResult {
  exampleId: string;
  score: number;
  rubric: RubricResult;
  verifierResults?: VerifierResult[];
  rollout: RolloutTrace;
  error?: string;
}

export interface LearningJobResult {
  jobId: string;
  score: number;
  examples: number;
  exampleResults?: ExampleEvalResult[];
  artifacts: LearningArtifact[];
  events: LearnRunEvent[];
}
```

### Prime adapter contracts

Represent Hosted Training config closely enough to serialize to TOML or JSON:

```ts
export interface PrimeTrainingConfig {
  model?: string;
  max_steps?: number;
  batch_size?: number;
  rollouts_per_example?: number;
  learning_rate?: number;
  lora_alpha?: number;
  oversampling_factor?: number;
  max_async_level?: number;
  trajectory_strategy?: 'interleaved' | 'branching';
  checkpoint_id?: string;
  env_file?: string[];
  sampling?: {
    max_tokens?: number;
    enable_thinking?: boolean;
    reasoning_effort?: 'low' | 'medium' | 'high';
  };
  env?: PrimeEnvironmentRef[];
  eval?: PrimeEvalConfig;
  val?: PrimeValidationConfig;
  buffer?: PrimeBufferConfig;
  checkpoints?: PrimeCheckpointConfig;
  adapters?: PrimeAdapterConfig;
  wandb?: PrimeWandbConfig;
  infrastructure?: { compute_size?: 'S' | 'M' | 'L' };
  metadata?: Record<string, unknown>;
}
```

The existing `primeBackend.createConfig(...)` should become a compatibility wrapper around a richer `createPrimeTrainingConfig(...)`.

## GEPA mapping

Prime GEPA config examples include:

```toml
model = "openai/gpt-4.1-mini"
reflection_model = "openai/gpt-4.1-mini"
endpoints_path = "../endpoints.toml"

[env]
env_id = "primeintellect/wiki-search"
env_args = {}
extra_env_kwargs = {}

[gepa]
max_calls = 500
num_train = 100
num_val = 50
minibatch_size = 3
perfect_score = 1.0
state_columns = ["tool_calls"]

[execution]
max_concurrent = 32
seed = 0
sampling_args = { max_tokens = 1024, temperature = 0.7 }
```

`@snapdragon-ai/learn` should add provider-independent prompt optimisation types first, then Prime GEPA config creation.

## SFT data generation mapping

Good rollouts from eval/RL should convert into SFT examples:

- include prompt, assistant messages, and tool messages;
- filter by minimum score and verifier pass;
- redact or truncate tool outputs if needed;
- preserve source example id, environment id, rubric scores, and token usage.

Proposed helpers:

- `rolloutToSftExample(...)`
- `collectSftExamples(...)`
- `filterSftExamples(...)`

## Browser/webtools implications

Prime documents browser environments via Browserbase. Snapdragon's intended browser stack is different: port the existing Hermes Agent Rust web crawler plugin, Camofox-backed, into a `webtools` package.

The learn package should model browser environments generically:

- `LearnEnvironmentKind: 'browser'`;
- browser sandbox/session metadata in `SandboxSpec` or a future `BrowserSpec`;
- tool traces for browser actions;
- verifiers for navigation success, DOM evidence, no hallucinated citations, and screenshot/artifact existence.

Do not block the learn package on webtools, but keep the contracts compatible.

## Implementation phases

### Phase 1: stronger local eval core

- Add `ExampleEvalResult`.
- Add `exampleResults` to `LearningJobResult` while preserving current fields.
- Add optional `continueOnError`, `onEvent`, and maybe `concurrency` to eval options.
- Preserve rubric signals per example.

### Phase 2: verifier layer

- Add `Verifier`, `VerifierResult`, `VerifierIssue`.
- Add initial anti-gaming verifier helpers.
- Add `evaluateVerifiers(...)`.
- Refactor `antiGamingRubric()` to share logic with verifiers where practical.

### Phase 3: environment and sandbox contracts

- Add `LearnEnvironment`, `SandboxSpec`, environment references on datasets/examples.
- Represent Prime environment ids and args without Prime-specific leakage into core types.

### Phase 4: Prime Hosted Training adapter

- Expand `PrimeTrainingConfig` to match Hosted Training TOML fields.
- Add `createPrimeTrainingConfig(...)`.
- Add config serialization helper if no TOML dependency is acceptable, or return plain object only and serialize elsewhere.
- Add tests based on `pi-agent-30b-1000.toml` shape.

### Phase 5: Prime eval / hosted eval adapter contracts

- Add types for Prime eval configs and sample upload/fetch shapes.
- Keep direct API submission optional until auth/team conventions are decided.
- Add gateway job payloads for local vs hosted eval.

### Phase 6: SFT generation

- Add `SftExample`, `SftDataset`, `SftDataPolicy`.
- Add conversion and filtering helpers from `ExampleEvalResult` / `RolloutTrace`.

### Phase 7: GEPA scaffold

- Add `PromptCandidate`, `PromptOptimizationJob`, candidate result types.
- Add Prime GEPA config shape based on observed examples.
- Reuse eval runner/rubrics/verifiers for candidate scoring.

### Phase 8: Python environment package bridge

- Decide where Python env templates live. Options:
  - `packages/learn/templates/prime-env`;
  - `examples/prime-agent-env`;
  - a future package dedicated to Python env generation.
- Generate a Prime `verifiers` environment from Snapdragon dataset/tool/rubric contracts where feasible.
- At minimum, document the mapping and include a checked-in sample environment.

### Phase 9: webtools/browser support

- Port Hermes Agent Rust Camofox crawler into a `webtools` package.
- Expose browser/crawl tools to agent/eval rollouts.
- Add browser environment contracts/verifiers that can map to Prime BrowserEnv or Snapdragon webtools.

## Open questions

- Should Prime CLI integration happen by shelling out, using Python SDK/API, or via TypeScript HTTP calls?
- Where should Python environment templates live in this TypeScript/Rust monorepo?
- What is the exact Prime `training/runs` request body? Need deeper OpenAPI inspection before implementing submit.
- How should gateway jobs represent long-running hosted training and polling?
- Which eval artifacts should be canonical: Prime samples, Snapdragon traces, or both?
- Do we want TOML serialization in `@snapdragon-ai/learn`, or only typed config objects?
- How do we handle secrets across local eval, hosted eval, RL training, and sandbox/webtools?

## Immediate coding recommendation

Start with TypeScript-only, backward-compatible changes in `packages/learn`:

1. local eval per-example results;
2. verifier contracts and anti-gaming helper verifiers;
3. environment/sandbox contracts;
4. expanded Prime config object and tests based on `pi-agent-rl-toolkit` config fields.

Avoid Prime job submission until the auth, team, and API/CLI path is decided.
