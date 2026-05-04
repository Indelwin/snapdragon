import type { SnapdragonAgent } from '@snapdragon-ai/agent';
import { normalizeToolsetsConfig } from '@snapdragon-ai/config';
import { memoryToolset, skillToolset } from '@snapdragon-ai/tools';
import type { SdConfig } from './config.js';
import type { SdExtensionRuntime } from './extension-runtime.js';
import type { SdMemoryProvider } from './memory.js';
import type { SdSkillStore } from './skills.js';
import type { SdTodoStore } from './todo.js';
import { todoToolset } from './todo.js';

export async function registerRuntimeToolsets(args: {
  agent: SnapdragonAgent;
  config: SdConfig;
  skills: SdSkillStore;
  memory: SdMemoryProvider;
  todo: SdTodoStore;
  extensionRuntime: SdExtensionRuntime;
}): Promise<void> {
  await args.agent.registry.register(
    skillToolset({ catalog: args.skills, authoring: args.config.skills?.authoring ?? true }),
  );
  await args.agent.registry.register(
    memoryToolset({ provider: args.memory, authoring: args.config.memory?.authoring ?? true }),
  );
  await registerTodoToolset(args);
  await args.agent.registry.registerMany(args.extensionRuntime.toolsets);
  applyToolsetFilters(args.agent, args.config);
}

async function registerTodoToolset(args: {
  agent: SnapdragonAgent;
  config: SdConfig;
  todo: SdTodoStore;
}): Promise<void> {
  if (args.config.todo?.enabled ?? true) await args.agent.registry.register(todoToolset(args.todo));
}

function applyToolsetFilters(agent: SnapdragonAgent, config: SdConfig): void {
  const toolsets = normalizeToolsetsConfig(config.toolsets);
  agent.registry.applyConfig({
    enabled: toolsets.enabled,
    disabled: toolsets.disabled,
    allowedTools: toolsets.allowedTools,
    deniedTools: toolsets.deniedTools,
  });
}
