import type { GatewayAgentRunSpec, PiRpcRuntimeOptions } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';

type PiRuntimeOptionSetter = (
  options: PiRpcRuntimeOptions,
  value: string,
  extraArgs: string[],
) => void;

const piRuntimeOptionSetters: Record<string, PiRuntimeOptionSetter> = {
  '--agent-dir': (options, value) => {
    options.agentDir = value;
  },
  '--arg': (_options, value, extraArgs) => {
    extraArgs.push(value);
  },
  '--command': (options, value) => {
    options.command = value;
  },
  '--cwd': (options, value) => {
    options.cwd = value;
  },
  '--id': (options, value) => {
    options.id = value;
  },
  '--label': (options, value) => {
    options.label = value;
  },
  '--session-dir': (options, value) => {
    options.sessionDir = value;
  },
};

export function agentSpecFromArgs(rest: string[], args: SdCliArgs): GatewayAgentRunSpec {
  const parsed = parseAgentRunArgs(rest);
  return {
    prompt: parsed.prompt.join(' '),
    targetRuntimeId: parsed.runtimeId,
    provider: args.provider,
    model: args.model,
    configPath: args.configPath,
    cwd: args.cwd,
    profile: args.profileName,
    session: 'new',
  };
}

export function parsePiRuntimeOptions(rest: string[]): PiRpcRuntimeOptions {
  const options: PiRpcRuntimeOptions = {};
  const extraArgs: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const consumed = applyPiRuntimeOption(options, extraArgs, rest, i);
    i += consumed;
  }
  if (extraArgs.length > 0) options.args = ['--mode', 'rpc', ...extraArgs];
  return options;
}

function parseAgentRunArgs(rest: string[]): { runtimeId?: string; prompt: string[] } {
  const prompt: string[] = [];
  let runtimeId: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    const [flag, inline] = splitInlineOption(token);
    if (flag === '--runtime' || flag === '--target-runtime') {
      runtimeId = inline ?? rest[i + 1];
      if (!inline) i += 1;
      continue;
    }
    prompt.push(token);
  }
  return { runtimeId, prompt };
}

function applyPiRuntimeOption(
  options: PiRpcRuntimeOptions,
  extraArgs: string[],
  rest: string[],
  index: number,
): number {
  const [flag, inline] = splitInlineOption(rest[index]);
  const value = inline ?? rest[index + 1];
  const consumed = inline ? 0 : 1;
  const setter = piRuntimeOptionSetters[flag];
  if (!value || !setter) return 0;
  setter(options, value, extraArgs);
  return consumed;
}

function splitInlineOption(token: string): [string, string | undefined] {
  const index = token.indexOf('=');
  if (index < 0) return [token, undefined];
  return [token.slice(0, index), token.slice(index + 1)];
}
