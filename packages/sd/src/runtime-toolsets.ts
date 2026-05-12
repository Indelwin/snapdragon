import type { SnapdragonAgent } from '@snapdragon-ai/agent';
import { normalizeToolsetsConfig } from '@snapdragon-ai/config';
import type { SdSessionIndex } from '@snapdragon-ai/session';
import { memoryToolset, skillToolset } from '@snapdragon-ai/tools';
import { webtoolsToolset } from '@snapdragon-ai/webtools';
import type { SdConfig } from './config.js';
import type { SdExtensionRuntime } from './extension-runtime.js';
import type { SdMemoryProvider } from './memory.js';
import { searchMessagesToolset } from './search-messages-tool.js';
import type { SdSkillStore } from './skills.js';
import type { SdTodoStore } from './todo.js';
import { todoToolset } from './todo.js';

export async function registerRuntimeToolsets(args: {
  agent: SnapdragonAgent;
  config: SdConfig;
  skills: SdSkillStore;
  memory: SdMemoryProvider;
  todo: SdTodoStore;
  sessionIndex?: SdSessionIndex;
  extensionRuntime: SdExtensionRuntime;
}): Promise<void> {
  await args.agent.registry.register(
    skillToolset({ catalog: args.skills, authoring: args.config.skills?.authoring ?? true }),
  );
  await args.agent.registry.register(
    memoryToolset({ provider: args.memory, authoring: args.config.memory?.authoring ?? true }),
  );
  await registerTodoToolset(args);
  await registerWebtoolsToolset(args);
  if (args.sessionIndex) {
    await args.agent.registry.register(searchMessagesToolset(args.sessionIndex));
  }
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

async function registerWebtoolsToolset(args: {
  agent: SnapdragonAgent;
  config: SdConfig;
}): Promise<void> {
  if (!(args.config.webtools?.enabled ?? true)) return;
  await args.agent.registry.register(
    webtoolsToolset({
      defaultUserAgent: args.config.webtools?.default_user_agent,
      defaultTimeoutMs: args.config.webtools?.default_timeout_ms,
    }),
  );
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
