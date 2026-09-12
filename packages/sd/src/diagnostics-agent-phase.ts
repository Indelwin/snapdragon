import type { AgentEvent, SnapdragonAgent } from '@snapdragon-ai/agent';
import type { SdDiagnosticsHandle, SdDiagnosticsPhase } from './diagnostics-types.js';
import type { SdRuntime } from './runtime.js';
import { observeSdRuntimeAgent } from './runtime-agent-events.js';

const eventPhases: Partial<Record<AgentEvent['type'], SdDiagnosticsPhase>> = {
  run_start: 'running',
  provider_event: 'provider',
  tool_start: 'tool',
  run_end: 'idle',
};

export interface SdDiagnosticsAgentPhaseBinding {
  rebind(): void;
  dispose(): void;
}

export function bindSdDiagnosticsAgentPhases(
  runtime: Pick<SdRuntime, 'agent'>,
  diagnostics: Pick<SdDiagnosticsHandle, 'setPhase'>,
): SdDiagnosticsAgentPhaseBinding {
  let boundAgent: SnapdragonAgent | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;

  const bindAgent = (agent: SnapdragonAgent): void => {
    if (disposed || boundAgent === agent) return;
    unsubscribe?.();
    boundAgent = agent;
    diagnostics.setPhase('idle');
    unsubscribe = boundAgent.subscribe((event) => {
      const phase = eventPhases[event.type];
      if (phase) diagnostics.setPhase(phase);
    });
  };
  const rebind = (): void => bindAgent(runtime.agent);
  const stopObserving = observeSdRuntimeAgent(runtime, bindAgent);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stopObserving();
    unsubscribe?.();
    unsubscribe = undefined;
    boundAgent = undefined;
  };

  rebind();
  return { rebind, dispose };
}
