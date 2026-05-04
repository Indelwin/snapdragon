import type { SdAgentConfig } from './agent-config-types.js';

export function mergeAgentConfig(
  defaults: SdAgentConfig | undefined,
  input: SdAgentConfig | undefined,
): SdAgentConfig {
  const merged = Object.assign({}, defaults, input) as SdAgentConfig;
  const defaultContext = defaults ? defaults.context : undefined;
  const inputContext = input ? input.context : undefined;
  const defaultReasoning = defaults ? defaults.reasoning : undefined;
  const inputReasoning = input ? input.reasoning : undefined;
  merged.context = Object.assign({}, defaultContext, inputContext);
  merged.reasoning = Object.assign({}, defaultReasoning, inputReasoning);
  return merged;
}
