# @snapdragon-ai/learn

Contracts and small local runners for Snapdragon learning jobs: datasets,
rollouts, rubrics, evals, training backends, and Prime Intellect adapter shapes.

The first runnable layer is local evals. `evaluateDataset(...)` scores rollouts
with a rubric and `learnJobToGatewayJob(...)` maps GEPA/SFT/RL/eval jobs onto
the durable gateway queue. Prime Intellect remains an adapter, not the learning
abstraction.
