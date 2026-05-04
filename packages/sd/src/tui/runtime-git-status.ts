import { execFileSync } from 'node:child_process';
import type { JsonObject } from '@snapdragon-ai/ui';

export function gitStatus(cwd: string): JsonObject | null {
  try {
    return {
      branch: git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'),
      sha: git(cwd, 'rev-parse', '--short', 'HEAD'),
    };
  } catch {
    return null;
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 250,
  })
    .toString()
    .trim();
}
