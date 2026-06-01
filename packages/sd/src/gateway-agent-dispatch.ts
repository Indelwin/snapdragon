import {
  type GatewayAgentRunSpec,
  type GatewayAgentRuntimeDescriptor,
  type GatewayAgentRuntimeObservedEvent,
  runPiRpcAgentJob,
} from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import {
  type HeadlessGatewayAgentResult,
  runHeadlessGatewayAgent,
} from './gateway-headless-agent.js';

export interface GatewayAgentDispatchOptions {
  args?: SdCliArgs;
  runtime?: GatewayAgentRuntimeDescriptor;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: GatewayAgentRuntimeObservedEvent) => void | Promise<void>;
}

export interface GatewayAgentDispatchResult extends HeadlessGatewayAgentResult {
  runtimeId: string;
  outputArtifact?: string;
}

export async function runGatewayAgentRuntime(
  spec: GatewayAgentRunSpec,
  options: GatewayAgentDispatchOptions = {},
): Promise<GatewayAgentDispatchResult> {
  const runtimeId = spec.targetRuntimeId ?? options.runtime?.id ?? 'sd';
  if (runtimeId === 'sd' || options.runtime?.kind === 'sd') {
    const result = await runHeadlessGatewayAgent(spec, options.args);
    return { ...result, runtimeId: 'sd' };
  }
  if (runtimeId === 'pi' || options.runtime?.kind === 'pi') {
    const result = await runPiRpcAgentJob(spec, {
      descriptor: options.runtime,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onEvent: options.onEvent,
    });
    return {
      runtimeId,
      summary: result.summary,
      content: result.content,
      metrics: result.metrics,
      outputArtifact: result.outputArtifact,
    };
  }
  throw new Error(`Unsupported agent runtime: ${runtimeId}`);
}
