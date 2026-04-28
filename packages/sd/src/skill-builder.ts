/**
 * Auto skill builder (stub).
 *
 * Goal: reflect on recent sessions and propose / write reusable skills, in
 * the same spirit as hermes-agent's skill workflow but agent-native and
 * automatic — the user shouldn't have to say "make this a skill", we should
 * notice the pattern, draft a skill, and (configurably) commit it.
 *
 * For now this file just registers the service shell so it slots into the
 * background gateway alongside the memory worker. The actual reflection /
 * authoring logic will land in a follow-up: it needs an LLM call (probably
 * `agent.run` with a constrained prompt) plus skill-store side effects, and
 * those concerns deserve their own design pass.
 *
 * Disabled by default in config; opt-in via `skills.builder.enabled = true`.
 */

import type {
  SdBackgroundContext,
  SdBackgroundService,
  SdBackgroundServiceResult,
} from './background.js';

export interface SdSkillBuilderConfig {
  enabled?: boolean;
  interval_ms?: number;
  lookback_sessions?: number;
  /** Minimum repeated-pattern signal before proposing a skill. */
  min_repetitions?: number;
}

export function skillBuilderService(): SdBackgroundService {
  return {
    name: 'skill-builder',
    enabled(ctx: SdBackgroundContext) {
      // Read from a (currently undeclared) `skills.builder` block. Until the
      // config schema lands officially, treat any truthy `enabled` as opt-in.
      const builder = (ctx.config.skills as { builder?: SdSkillBuilderConfig } | undefined)
        ?.builder;
      return builder?.enabled === true;
    },
    intervalMs(ctx: SdBackgroundContext) {
      const builder = (ctx.config.skills as { builder?: SdSkillBuilderConfig } | undefined)
        ?.builder;
      return builder?.interval_ms ?? 30 * 60 * 1000; // default 30min
    },
    async runOnce(ctx: SdBackgroundContext): Promise<SdBackgroundServiceResult> {
      // TODO: scan recent sessions, detect reusable patterns, draft a skill,
      // write to the user's skill root (gated by an authoring flag). For now
      // we just no-op and report a heartbeat so operators can see the
      // service is wired up.
      ctx.log('skill-builder: not yet implemented (heartbeat)');
      return {
        summary: 'skill-builder stub heartbeat',
        metrics: { proposals: 0, written: 0 },
      };
    },
  };
}
