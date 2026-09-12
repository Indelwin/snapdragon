import { ToolRegistry, type ToolRegistryOptions, type Toolset } from '@snapdragon-ai/tools';

export interface PreparedAgentRegistry {
  registry: ToolRegistry;
  owned: boolean;
}

export async function prepareAgentRegistry(
  cwd: string,
  tools: ToolRegistry | Toolset[] | undefined,
  ownsInjectedRegistry: boolean,
): Promise<PreparedAgentRegistry> {
  if (tools instanceof ToolRegistry) {
    return { registry: tools, owned: ownsInjectedRegistry };
  }
  return { registry: await createOwnedToolRegistry({ cwd }, tools ?? []), owned: true };
}

export async function createOwnedToolRegistry(
  options: ToolRegistryOptions,
  toolsets: Toolset[],
): Promise<ToolRegistry> {
  const registry = new ToolRegistry(options);
  try {
    await registry.registerMany(toolsets);
    return registry;
  } catch (error) {
    await registry.dispose();
    throw error;
  }
}

export function disposeAgentRegistry(registry: ToolRegistry, owned: boolean): Promise<void> {
  return owned ? registry.dispose() : Promise.resolve();
}
