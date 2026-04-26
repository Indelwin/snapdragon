import type { JsonObject, JsonValue } from '@snapdragon/core';
import type { ToolDefinition } from '@snapdragon/host';

export interface ToolContext {
  cwd: string;
  session: Map<string, unknown>;
  registry?: ToolInvoker;
  signal?: AbortSignal;
}

export interface ToolInvoker {
  listDefinitions(): ToolDefinition[];
  describe(name: string): ToolDefinition | undefined;
  invoke(name: string, args: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  data?: JsonValue;
  terminate?: boolean;
}

export interface Tool {
  name: string;
  toolset: string;
  description: string;
  parameters: JsonObject;
  run(args: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface Toolset {
  name: string;
  title: string;
  description: string;
  tools: Tool[];
  check?: () => Promise<ToolsetCheck> | ToolsetCheck;
}

export interface ToolsetCheck {
  available: boolean;
  reason?: string;
}

export interface RegisteredTool extends Tool {
  enabled: boolean;
  unavailableReason?: string;
}

export function toolToDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}
