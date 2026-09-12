import type { SnapdragonAgent } from '@snapdragon-ai/agent';
import type { SdRuntime } from './runtime.js';

type RuntimeAgent = Pick<SdRuntime, 'agent'>;
type RuntimeAgentListener = (agent: SnapdragonAgent) => void;

const listeners = new WeakMap<RuntimeAgent, Set<RuntimeAgentListener>>();

export function observeSdRuntimeAgent(
  runtime: RuntimeAgent,
  listener: RuntimeAgentListener,
): () => void {
  let observers = listeners.get(runtime);
  if (!observers) {
    observers = new Set();
    listeners.set(runtime, observers);
  }
  observers.add(listener);
  return () => {
    observers.delete(listener);
    if (observers.size === 0 && listeners.get(runtime) === observers) listeners.delete(runtime);
  };
}

export function notifySdRuntimeAgentChanged(runtime: RuntimeAgent): void {
  for (const listener of [...(listeners.get(runtime) ?? [])]) {
    try {
      listener(runtime.agent);
    } catch {
      // Observers cannot roll back a completed runtime transition.
    }
  }
}
