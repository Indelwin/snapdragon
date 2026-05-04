/**
 * Similarity-query construction for the skill-builder drafter.
 *
 * The drafter receives a list of "skills already in the catalog that look
 * similar to this candidate" so it can SKIP near-duplicates. Previously we
 * passed the FULL catalog (`ctx.skills.list()`) — fine when small, linear
 * in catalog size. Now we route through `ctx.skills.search()` (which itself
 * routes through the FTS index when attached) with a query built from the
 * candidate's most discriminating signals.
 *
 * Query composition (FTS sanitizer treats this as `tok OR tok OR ...*`):
 *   1. The first example's `precedingPrompt` — most user-facing description
 *      of what the workflow is FOR. Highest signal.
 *   2. The n-gram tool names — backstop when no example prompt is recorded.
 *
 * We deliberately stay query-OR-flavoured (recall over precision): the goal
 * is to surface ANY plausibly-overlapping skill so the LLM can decide.
 */

import type { CandidateExample, SdSkillPattern } from './skill-builder-types.js';

const DEFAULT_PROMPT_CHARS = 200;

export function buildSkillSimilarityQuery(
  candidate: SdSkillPattern,
  options: { maxPromptChars?: number } = {},
): string {
  const maxChars = options.maxPromptChars ?? DEFAULT_PROMPT_CHARS;
  const example = firstExampleWithPrompt(candidate.examples);
  const promptText = example ? example.precedingPrompt.slice(0, maxChars) : '';
  const parts: string[] = [];
  if (promptText.trim().length > 0) parts.push(promptText);
  for (const tool of candidate.ngram) parts.push(tool);
  return parts.join(' ').trim();
}

function firstExampleWithPrompt(
  examples: readonly CandidateExample[] | undefined,
): CandidateExample | undefined {
  if (!examples) return undefined;
  for (const example of examples) {
    if (example.precedingPrompt.trim().length > 0) return example;
  }
  return undefined;
}
