import { spawn } from 'node:child_process';
import { createPiRpcSession } from './pi-rpc-session.js';
import { piProcessSpec } from './pi-rpc-spawn-options.js';
import { ownPiProcessGroup } from './pi-rpc-stop.js';
import type { PiRpcRuntimeOptions, PiRpcSession } from './pi-rpc-types.js';
import type { GatewayAgentRuntimeDescriptor } from './types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

export function startPiRpcSession(
  options: PiRpcRuntimeOptions,
  spec?: GatewayAgentRunSpec,
  descriptor?: GatewayAgentRuntimeDescriptor,
): PiRpcSession {
  const processSpec = piProcessSpec(options, spec, descriptor);
  const child = spawn(processSpec.command, processSpec.args, {
    cwd: processSpec.cwd,
    env: processSpec.env,
    stdio: 'pipe',
    detached: process.platform !== 'win32',
  });
  if (process.platform !== 'win32') ownPiProcessGroup(child);
  return createPiRpcSession(child, options);
}
