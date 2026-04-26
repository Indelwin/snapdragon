import { type Context, createContext, Script } from 'node:vm';
import type { JsonObject } from '@snapdragon/core';
import { objectArg, optionalNumberArg, stringArg } from '../safety.js';
import type { Tool, ToolResult, Toolset } from '../types.js';

export interface ReplToolsetOptions {
  defaultTimeoutMs?: number;
}

interface ReplState {
  context: Context;
}

const STATE_KEY = 'snapdragon.repl.state';

export function replToolset(options: ReplToolsetOptions = {}): Toolset {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
  return {
    name: 'repl',
    title: 'REPL tools',
    description:
      'Evaluate JavaScript against a persistent sandbox with an SDK for invoking registered tools.',
    tools: [replEvalTool(defaultTimeoutMs)],
  };
}

function replEvalTool(defaultTimeoutMs: number): Tool {
  return {
    name: 'repl_eval',
    toolset: 'repl',
    description:
      'Evaluate JavaScript in a persistent sandbox. Use sdk.list(), sdk.describe(name), and await sdk.invoke(name, args).',
    parameters: schema(
      {
        code: { type: 'string' },
        timeout_ms: { type: 'number', default: defaultTimeoutMs },
      },
      ['code'],
    ),
    async run(args, context): Promise<ToolResult> {
      const input = objectArg(args);
      const code = stringArg(input, 'code');
      const timeoutMs = optionalNumberArg(input, 'timeout_ms') ?? defaultTimeoutMs;
      const state = getState(context.session);
      state.context.sdk = {
        list: () => context.registry?.listDefinitions() ?? [],
        describe: (name: string) => context.registry?.describe(name),
        invoke: async (name: string, toolArgs: unknown) => {
          if (!context.registry) throw new Error('No tool registry available');
          return context.registry.invoke(name, toolArgs, context);
        },
      };

      try {
        const result = await evaluate(code, state.context, timeoutMs);
        return { content: renderValue(result) };
      } catch (error) {
        return {
          content: error instanceof Error ? (error.stack ?? error.message) : String(error),
          isError: true,
        };
      }
    },
  };
}

async function evaluate(code: string, context: Context, timeoutMs: number): Promise<unknown> {
  const source = expressionSource(code) ?? blockSource(code);
  const script = new Script(source, { filename: 'snapdragon-repl.vm.js' });
  return script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>;
}

function expressionSource(code: string): string | undefined {
  try {
    new Script(`(async () => (${code}))()`);
    return `(async () => (${code}))()`;
  } catch {
    return undefined;
  }
}

function blockSource(code: string): string {
  return `(async () => { ${code}\n})()`;
}

function getState(session: Map<string, unknown>): ReplState {
  const existing = session.get(STATE_KEY);
  if (existing && typeof existing === 'object' && 'context' in existing) {
    return existing as ReplState;
  }
  const state: ReplState = {
    context: createContext({
      console,
      TextDecoder,
      TextEncoder,
      URL,
    }),
  };
  session.set(STATE_KEY, state);
  return state;
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, null, 2);
}

function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}
