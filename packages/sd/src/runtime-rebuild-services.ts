import { ensureFirstPartyExtensionsForConfig } from './first-party.js';
import { resolveSdRuntimeConfig } from './profile-runtime.js';
import type { SdRuntime } from './runtime.js';
import { disposeRuntimeResources } from './runtime.js';
import { notifySdRuntimeAgentChanged } from './runtime-agent-events.js';
import {
  prepareRuntimeRebuildCandidate,
  type RuntimeRebuildRequest,
} from './runtime-rebuild-candidate.js';

export async function applyRuntimeRebuild(
  runtime: SdRuntime,
  request: RuntimeRebuildRequest,
): Promise<void> {
  const baseConfig = request.baseConfig ?? runtime.baseConfig;
  const { config, systemPrompt } = resolveSdRuntimeConfig(
    baseConfig,
    request.profile,
    request.overrides,
  );
  ensureFirstPartyExtensionsForConfig(config);
  const candidate = await prepareRuntimeRebuildCandidate(runtime, request, config, systemPrompt);
  const previous = ownedRuntimeResources(runtime);
  Object.assign(runtime, candidate);
  notifySdRuntimeAgentChanged(runtime);
  await disposeRuntimeResources(previous);
}

function ownedRuntimeResources(runtime: SdRuntime) {
  return {
    agent: runtime.agent,
    background: runtime.background,
    sessionIndex: runtime.sessionIndex,
    searchIndex: runtime.searchIndex,
    extensionRuntime: runtime.extensionRuntime,
  };
}
