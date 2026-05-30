import { piRuntimeEnv } from './pi-rpc-descriptor.js';
import {
  DEFAULT_PI_COMMAND,
  DEFAULT_RPC_ARGS,
  type PiRpcProcessSpec,
  type PiRpcRuntimeOptions,
} from './pi-rpc-types.js';
import type { GatewayAgentRuntimeDescriptor } from './types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

export function piProcessSpec(
  options: PiRpcRuntimeOptions,
  spec?: GatewayAgentRunSpec,
  descriptor?: GatewayAgentRuntimeDescriptor,
): PiRpcProcessSpec {
  const worker = descriptor?.command;
  return {
    command: options.command ?? worker?.command ?? DEFAULT_PI_COMMAND,
    args: [...(options.args ?? worker?.args ?? DEFAULT_RPC_ARGS), ...specArgs(spec)],
    cwd: spec?.cwd ?? options.cwd ?? worker?.cwd,
    env: mergedEnv(options, worker?.env),
  };
}

function specArgs(spec?: GatewayAgentRunSpec): string[] {
  if (!spec) return [];
  return [
    ...valueArg('--provider', spec.provider),
    ...valueArg('--model', spec.model),
    ...sessionArgs(spec),
    ...valueArg('--tools', spec.toolsets?.join(',')),
  ];
}

function sessionArgs(spec: GatewayAgentRunSpec): string[] {
  if (spec.session === 'none') return ['--no-session'];
  if (spec.session === 'resume' && spec.sessionId) return ['--session', spec.sessionId];
  if (spec.session === 'resume') return ['--continue'];
  return [];
}

function valueArg(flag: string, value: string | undefined): string[] {
  return value ? [flag, value] : [];
}

function mergedEnv(
  options: PiRpcRuntimeOptions,
  descriptorEnv?: Record<string, string>,
): NodeJS.ProcessEnv {
  const base = options.inheritEnv === false ? {} : process.env;
  return {
    ...base,
    ...descriptorEnv,
    ...piRuntimeEnv(options),
    ...options.env,
  };
}
