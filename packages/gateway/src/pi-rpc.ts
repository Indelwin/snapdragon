import { commandCount, createPiRpcRuntimeDescriptor } from './pi-rpc-descriptor.js';
import { startPiRpcSession } from './pi-rpc-process.js';
import { PiRpcRunController } from './pi-rpc-run-controller.js';
import type {
  PiRpcAgentJobOptions,
  PiRpcAgentRunResult,
  PiRpcRuntimeOptions,
} from './pi-rpc-types.js';
import { DEFAULT_TIMEOUT_MS } from './pi-rpc-types.js';
import type { GatewayAgentRuntimeDescriptor } from './types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

export { createPiRpcRuntimeDescriptor } from './pi-rpc-descriptor.js';
export type {
  PiRpcAgentJobOptions,
  PiRpcAgentRunResult,
  PiRpcEventRetentionStats,
  PiRpcObservedEvent,
  PiRpcObserverContext,
  PiRpcRetentionStats,
  PiRpcRuntimeOptions,
  PiRpcTraceSink,
} from './pi-rpc-types.js';

export async function probePiRpcRuntime(
  options: PiRpcRuntimeOptions = {},
): Promise<GatewayAgentRuntimeDescriptor> {
  const startedAtMs = Date.now();
  const session = startPiRpcSession(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Pi RPC probe timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    const state = await Promise.race([session.send({ type: 'get_state' }), deadline]);
    const commands =
      state.success === false
        ? state
        : await Promise.race([session.send({ type: 'get_commands' }), deadline]);
    const failure =
      state.success === false ? state : commands.success === false ? commands : undefined;
    const descriptor = createPiRpcRuntimeDescriptor(options);
    return {
      ...descriptor,
      health: {
        state: failure ? 'unhealthy' : 'ok',
        checkedAtMs: Date.now(),
        message: failure ? failure.error : 'Pi RPC responded',
      },
      metadata: {
        ...descriptor.metadata,
        state: state.data,
        commandCount: commandCount(commands.data),
        probeMs: Date.now() - startedAtMs,
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
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
