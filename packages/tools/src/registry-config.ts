import type { RegisteredTool } from './types.js';

export interface ToolRegistryConfig {
  enabled?: string[];
  disabled?: string[];
  allowedTools?: string[];
  deniedTools?: string[];
  allowed_tools?: string[];
  denied_tools?: string[];
}

export interface ToolsetState {
  available: boolean;
  enabled: boolean;
  unavailableReason?: string;
}

export function applyRegistryConfig(
  tools: Iterable<RegisteredTool>,
  toolsets: Map<string, ToolsetState>,
  config: ToolRegistryConfig,
): void {
  const filter = {
    enabledToolsets: new Set(config.enabled ?? []),
    disabledToolsets: new Set(config.disabled ?? []),
    allowedTools: optionalSet(config.allowedTools ?? config.allowed_tools),
    deniedTools: new Set(config.deniedTools ?? config.denied_tools ?? []),
  };
  for (const [name, toolset] of toolsets) {
    toolset.enabled = toolsetIsEnabled(name, toolset, filter);
  }
  for (const tool of tools) {
    const toolset = toolsets.get(tool.toolset);
    tool.enabled = toolIsEnabled(tool.name, toolset, filter);
    tool.unavailableReason = tool.enabled ? undefined : disabledReason(tool, toolset);
  }
}

export function toolsetSummary(toolsets: Map<string, ToolsetState>) {
  return [...toolsets.entries()].map(([name, toolset]) => ({
    name,
    available: toolset.available,
    enabled: toolset.enabled,
    reason: toolset.unavailableReason,
  }));
}

interface RegistryFilter {
  enabledToolsets: Set<string>;
  disabledToolsets: Set<string>;
  allowedTools: Set<string> | undefined;
  deniedTools: Set<string>;
}

function toolsetIsEnabled(name: string, toolset: ToolsetState, filter: RegistryFilter): boolean {
  const allowed = filter.enabledToolsets.size === 0 || filter.enabledToolsets.has(name);
  return toolset.available && allowed && !filter.disabledToolsets.has(name);
}

function toolIsEnabled(
  name: string,
  toolset: ToolsetState | undefined,
  filter: RegistryFilter,
): boolean {
  const allowed = !filter.allowedTools || filter.allowedTools.has(name);
  return (toolset?.enabled ?? false) && allowed && !filter.deniedTools.has(name);
}

function optionalSet(values: string[] | undefined): Set<string> | undefined {
  return values && values.length > 0 ? new Set(values) : undefined;
}

function disabledReason(
  tool: RegisteredTool,
  toolset: ToolsetState | undefined,
): string | undefined {
  if (toolset?.unavailableReason) return toolset.unavailableReason;
  if (toolset && !toolset.available) return `${tool.toolset} is unavailable`;
  return tool.unavailableReason;
}
