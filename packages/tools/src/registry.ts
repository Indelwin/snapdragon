import type { Tool, ToolContext, ToolResult, Toolset, RegisteredTool } from './types.js';
import { toolToDefinition } from './types.js';
import type { ToolDefinition } from '@snapdragon/host';

export interface ToolRegistryOptions {
  cwd: string;
  session?: Map<string, unknown>;
}

export class ToolRegistry {
  readonly cwd: string;
  readonly session: Map<string, unknown>;
  #tools = new Map<string, RegisteredTool>();

  constructor(options: ToolRegistryOptions) {
    this.cwd = options.cwd;
    this.session = options.session ?? new Map<string, unknown>();
  }

  async register(toolset: Toolset): Promise<void> {
    const check = toolset.check ? await toolset.check() : { available: true };
    for (const tool of toolset.tools) {
      this.#tools.set(tool.name, {
        ...tool,
        enabled: check.available,
        unavailableReason: check.available ? undefined : check.reason ?? `${toolset.name} is unavailable`,
      });
    }
  }

  async registerMany(toolsets: Toolset[]): Promise<void> {
    for (const toolset of toolsets) await this.register(toolset);
  }

  list(): RegisteredTool[] {
    return [...this.#tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  listEnabled(): RegisteredTool[] {
    return this.list().filter((tool) => tool.enabled);
  }

  listDefinitions(): ToolDefinition[] {
    return this.listEnabled().map(toolToDefinition);
  }

  describe(name: string): ToolDefinition | undefined {
    const tool = this.#tools.get(name);
    if (!tool || !tool.enabled) return undefined;
    return toolToDefinition(tool);
  }

  async invoke(name: string, args: unknown, context?: Partial<ToolContext>): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) {
      return { content: `Tool not found: ${name}`, isError: true };
    }
    if (!tool.enabled) {
      return {
        content: tool.unavailableReason ?? `Tool unavailable: ${name}`,
        isError: true,
      };
    }

    try {
      return await tool.run(args, {
        cwd: context?.cwd ?? this.cwd,
        session: context?.session ?? this.session,
        signal: context?.signal,
        registry: this,
      });
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }
}

export function defineTool(tool: Tool): Tool {
  return tool;
}
