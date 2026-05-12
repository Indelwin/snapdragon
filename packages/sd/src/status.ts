/**
 * `/status` — the AX self-aware dashboard. One read-only call that surfaces
 * everything an agent (or operator) typically asks five separate slash
 * commands to discover: provider/model, session, profile, services, memory,
 * skills, profiles, extensions, tools, and a brief git fingerprint.
 *
 * Pure read-only: never mutates runtime state, never spawns work, never
 * calls the model. Designed to finish in a few ms so it can be invoked
 * cheaply at the start of a session or whenever the agent loses
 * orientation.
 *
 * Manifesto reference: "Self-Aware — the agent knows its own state without
 * introspection." This is the one-call replacement for grepping through
 * /extensions /memory /skills /profile /tools /session.
 *
 * Format helpers live in `./status-format.ts`; this file owns the data
 * shape and the (tolerant) collectors.
 */

import { execFileSync } from 'node:child_process';
import type { SdBackgroundServiceStatus } from './background.js';
import type { SdRuntime } from './runtime.js';

export { formatSdStatus } from './status-format.js';

export interface SdStatusGitInfo {
  branch?: string;
  sha?: string;
  dirty?: boolean;
}

export interface SdStatusReasoning {
  enabled: boolean;
  effort?: string;
}

export interface SdStatusReport {
  agent: {
    provider: string;
    model: string;
    reasoning: SdStatusReasoning;
    contextTokens?: number;
    outputTokens?: number;
    messages: number;
  };
  cwd: string;
  git?: SdStatusGitInfo;
  session?: {
    id: string;
    messages: number;
  };
  profile?: string;
  services: SdBackgroundServiceStatus[];
  memory: {
    enabled: boolean;
    total: number;
    tentative: number;
    path?: string;
  };
  skills: {
    total: number;
    bySource: Record<string, number>;
  };
  profiles: {
    total: number;
    names: string[];
  };
  extensions: {
    total: number;
    errors: number;
    ids: string[];
  };
  tools: {
    total: number;
  };
  generatedAt: string;
}

/**
 * Gather the structured status report. Tolerant of partial runtimes: any
 * source that throws or returns a Promise (when sync access isn't available)
 * folds to a safe default rather than failing the whole dashboard.
 */
export function gatherSdStatus(runtime: SdRuntime, now = Date.now): SdStatusReport {
  const reasoning = runtime.config.agent?.reasoning;
  return {
    agent: {
      provider: runtime.provider.id,
      model: runtime.provider.model,
      reasoning: {
        enabled: reasoning?.enabled !== false,
        effort: reasoning?.effort,
      },
      contextTokens: runtime.config.agent?.context?.max_request_tokens,
      outputTokens: runtime.config.agent?.max_tokens,
      messages: runtime.agent.messages.length,
    },
    cwd: runtime.agent.cwd,
    git: collectGitInfo(runtime.agent.cwd),
    session: runtime.session
      ? { id: runtime.session.sessionId, messages: runtime.session.messageCount() }
      : undefined,
    profile: runtime.profile?.name,
    services: runtime.background.list(),
    memory: collectMemoryStatus(runtime),
    skills: collectSkillStatus(runtime),
    profiles: {
      total: runtime.profileStore.list().length,
      names: runtime.profileStore.list().map((p) => p.name),
    },
    extensions: {
      total: runtime.extensions.list().length,
      errors: runtime.extensionRuntime.errors.length,
      ids: runtime.extensions.list().map((e) => e.id),
    },
    tools: { total: runtime.agent.registry.listDefinitions().length },
    generatedAt: new Date(now()).toISOString(),
  };
}

function collectMemoryStatus(runtime: SdRuntime): SdStatusReport['memory'] {
  const enabled = runtime.config.memory?.enabled !== false;
  if (!enabled) return { enabled: false, total: 0, tentative: 0 };
  try {
    const read = runtime.memory.read();
    if (read instanceof Promise) return { enabled, total: 0, tentative: 0 };
    const tentative = read.entries.filter((e) => e.tags?.includes('tentative')).length;
    return { enabled, total: read.entries.length, tentative };
  } catch {
    return { enabled, total: 0, tentative: 0 };
  }
}

function collectSkillStatus(runtime: SdRuntime): SdStatusReport['skills'] {
  const list = runtime.skills.list();
  const bySource: Record<string, number> = {};
  for (const skill of list) {
    const source = skill.source ?? 'unknown';
    bySource[source] = (bySource[source] ?? 0) + 1;
  }
  return { total: list.length, bySource };
}

function collectGitInfo(cwd: string): SdStatusGitInfo | undefined {
  const branch = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const sha = runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  if (!branch && !sha) return undefined;
  // `--quiet` exits 1 on unstaged changes — catch that to set dirty=true.
  let dirty = false;
  try {
    execFileSync('git', ['diff', '--quiet', '--exit-code'], {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 250,
    });
  } catch {
    dirty = true;
  }
  return { branch, sha, dirty };
}

function runGit(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 250,
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}
