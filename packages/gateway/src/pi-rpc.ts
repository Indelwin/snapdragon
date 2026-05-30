import { commandCount, createPiRpcRuntimeDescriptor } from './pi-rpc-descriptor.js';
import { startPiRpcSession } from './pi-rpc-process.js';
import { PiRpcRunController } from './pi-rpc-run-controller.js';
import type {
  PiRpcAgentJobOptions,
  PiRpcAgentRunResult,
  PiRpcRuntimeOptions,
} from './pi-rpc-types.js';
import type { GatewayAgentRuntimeDescriptor } from './types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

export { createPiRpcRuntimeDescriptor } from './pi-rpc-descriptor.js';
export type {
  PiRpcAgentJobOptions,
  PiRpcAgentRunResult,
  PiRpcObservedEvent,
  PiRpcRuntimeOptions,
} from './pi-rpc-types.js';

export async function probePiRpcRuntime(
  options: PiRpcRuntimeOptions = {},
): Promise<GatewayAgentRuntimeDescriptor> {
  const startedAtMs = Date.now();
  const session = startPiRpcSession(options);
  try {
    const state = await session.send({ type: 'get_state' });
    const commands = await session.send({ type: 'get_commands' });
    const descriptor = createPiRpcRuntimeDescriptor(options);
    return {
      ...descriptor,
      health: {
        state: state.success === false ? 'unhealthy' : 'ok',
        checkedAtMs: Date.now(),
        message: state.success === false ? state.error : 'Pi RPC responded',
      },
      metadata: {
        ...descriptor.metadata,
        state: state.data,
        commandCount: commandCount(commands.data),
        probeMs: Date.now() - startedAtMs,
      },
    };
  } finally {
    await session.stop();
  }
}

export async function runPiRpcAgentJob(
  spec: GatewayAgentRunSpec,
  options: PiRpcAgentJobOptions = {},
): Promise<PiRpcAgentRunResult> {
  const controller = new PiRpcRunController(spec, options);
  return controller.run();
}
