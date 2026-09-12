import { loadSdConfig } from './config.js';
import { defaultReloadShellRunner } from './reload-shell-runner.js';
import type {
  ReloadOptions,
  ReloadReport,
  ReloadShellResult,
  ReloadStepReport,
  SdRestartRequest,
} from './reload-types.js';
import type { SdRuntime } from './runtime.js';
import { rebuildSdRuntime } from './runtime-transitions.js';

export { formatReloadReport } from './reload-format.js';
export { defaultReloadShellRunner } from './reload-shell-runner.js';
export type {
  ReloadOptions,
  ReloadReport,
  ReloadShellResult,
  ReloadShellRunner,
  ReloadStepReport,
  SdRestartRequest,
  SdRestartState,
} from './reload-types.js';

const DEFAULT_BUILD_COMMAND = ['npm', 'run', 'build'] as const;

/**
 * Data-only reloads rebuild transactionally in-process. Pull/build requests
 * return restart state so the embedding can start a fresh executable after
 * the current command/run has drained.
 */
export async function reloadSdRuntime(
  runtime: SdRuntime,
  options: ReloadOptions = {},
): Promise<ReloadReport> {
  const start = Date.now();
  const runner = options.runner ?? defaultReloadShellRunner;
  const progress = options.progress ?? noopProgress;
  const cwd = runtime.agent.cwd;

  let pulled: ReloadStepReport | undefined;
  if (options.pull) {
    progress('reload: git pull...');
    pulled = await runStep(runner, 'git', ['pull', '--ff-only'], cwd, 5);
  }

  let built: ReloadStepReport | undefined;
  if (options.build) {
    progress('reload: building...');
    built = await runStep(runner, ...splitBuildCommand(options.buildCommand), cwd, 8);
  }

  const executableReload = options.pull || options.build;
  let restart: SdRestartRequest | undefined;
  if (executableReload) {
    if (successfulSteps(pulled, built)) restart = restartRequest(runtime, options.draft);
  } else {
    progress('reload: rebuilding runtime...');
    const baseConfig = await loadSdConfig(runtime.options.configPath);
    await rebuildSdRuntime(runtime, {
      baseConfig,
      provider: runtime.provider.id,
      model: runtime.provider.model,
    });
  }

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
    restart,
  };
}

function successfulSteps(
  pulled: ReloadStepReport | undefined,
  built: ReloadStepReport | undefined,
): boolean {
  return pulled?.ok !== false && built?.ok !== false;
}

function restartRequest(runtime: SdRuntime, draft: string | undefined): SdRestartRequest {
  return {
    kind: 'restart',
    reason: 'executable_reload',
    state: {
      sessionId: runtime.session?.sessionId,
      noSession: runtime.session === undefined,
      provider: runtime.provider.id,
      model: runtime.provider.model,
      profileName: runtime.profile?.name,
      noProfile: runtime.profile === undefined,
      ...(draft !== undefined ? { draft } : {}),
    },
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

const noopProgress = (_label: string): void => undefined;

function tailOf(result: ReloadShellResult, n: number): string {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (!text) return '';
  return text.split('\n').slice(-n).join('\n');
}
