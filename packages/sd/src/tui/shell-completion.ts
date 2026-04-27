import { readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function discoverShellCommands(cwd: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const names = new Set(['cat', 'cd', 'clear', 'git', 'ls', 'npm', 'pwd', 'rg']);
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    addExecutables(names, dir);
  }
  addExecutables(names, cwd);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function addExecutables(names: Set<string>, dir: string): void {
  try {
    for (const entry of readdirSync(dir)) {
      if (!isExecutable(join(dir, entry))) continue;
      names.add(entry);
    }
  } catch {
    // PATH entries often disappear; completion should stay best-effort.
  }
}

function isExecutable(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
