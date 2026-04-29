import { spawn } from 'node:child_process';
import type {
  ReloadOptions,
  ReloadReport,
  ReloadShellResult,
  ReloadStepReport,
} from './reload-types.js';
import type { SdRuntime } from './runtime.js';
import { rebuildSdRuntime } from './runtime-transitions.js';

export { formatReloadReport } from './reload-format.js';
export type {
  ReloadOptions,
  ReloadReport,
  ReloadShellResult,
  ReloadShellRunner,
  ReloadStepReport,
} from './reload-types.js';

const DEFAULT_BUILD_COMMAND = ['npm', 'run', 'build'] as const;

/**
 * Phase-0 hot reload: optionally pull the working copy, optionally rebuild
 * the workspace, then call `rebuildSdRuntime()` so anything discovered from
 * disk (extensions, skills, profiles, memory provider) refreshes.
 *
 * Deliberately does NOT reload core packages (host/agent/tools) or the
 * TUI tree — those are statically `import`-ed once at process start and
 * Node's ESM cache cannot be invalidated for them in-place. The CLI
 * formatter (`formatReloadReport`) is honest about this.
 */
export async function reloadSdRuntime(
  runtime: SdRuntime,
  options: ReloadOptions = {},
): Promise<ReloadReport> {
  const start = Date.now();
  const runner = options.runner ?? defaultReloadShellRunner;
  const cwd = runtime.agent.cwd;

  const pulled = options.pull
    ? await runStep(runner, 'git', ['pull', '--ff-only'], cwd, 5)
    : undefined;
  const built = options.build
    ? await runStep(runner, ...splitBuildCommand(options.buildCommand), cwd, 8)
    : undefined;

  // Rebuild the runtime regardless of pull/build outcomes — a partial
  // failure shouldn't block extension/skill refresh, and the report makes
  // any failures visible.
  await rebuildSdRuntime(runtime, {
    provider: runtime.provider.id,
    model: runtime.provider.model,
  });

  return {
    pulled,
    built,
    extensions: runtime.extensions.list().length,
    extensionErrors: runtime.extensionRuntime.errors.length,
    skills: runtime.skills.list().length,
    profiles: runtime.profileStore.list().length,
    services: runtime.background.list().length,
    provider: `${runtime.provider.id}/${runtime.provider.model}`,
    durationMs: Date.now() - start,
  };
}

/**
 * Parse the trailing argument of `/reload` into pull/build flags.
 * Accepts: '' | 'pull' | 'build' | 'sync' (= pull + build) | 'all', plus
 * any space-separated combination.
 */
export function parseReloadArg(arg: string): {
  pull: boolean;
  build: boolean;
  unknown: string[];
} {
  const tokens = arg.split(/\s+/).filter(Boolean);
  const flags = { pull: false, build: false };
  const unknown: string[] = [];
  for (const token of tokens) applyReloadToken(token, flags, unknown);
  return { ...flags, unknown };
}

function applyReloadToken(
  token: string,
  flags: { pull: boolean; build: boolean },
  unknown: string[],
): void {
  if (token === 'pull') flags.pull = true;
  else if (token === 'build') flags.build = true;
  else if (token === 'sync' || token === 'all') {
    flags.pull = true;
    flags.build = true;
  } else unknown.push(token);
}

async function runStep(
  runner: NonNullable<ReloadOptions['runner']>,
  command: string,
  args: string[],
  cwd: string,
  tailLines: number,
): Promise<ReloadStepReport> {
  const result = await runner(command, args, cwd);
  return { ok: result.code === 0, tail: tailOf(result, tailLines) };
}

function splitBuildCommand(override: ReloadOptions['buildCommand']): [string, string[]] {
  const [cmd, ...args] = override ?? DEFAULT_BUILD_COMMAND;
  return [cmd, args];
}

function tailOf(result: ReloadShellResult, n: number): string {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (!text) return '';
  return text.split('\n').slice(-n).join('\n');
}

/**
 * Default runner: spawn the command in its own process group so a hung
 * build can be killed cleanly (mirrors the run_shell process-group fix).
 */
export const defaultReloadShellRunner = (
  command: string,
  args: string[],
  cwd: string,
): Promise<ReloadShellResult> =>
  new Promise<ReloadShellResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.on('error', (error) => resolve({ stdout, stderr: `${stderr}${error.message}`, code: 1 }));
  });
