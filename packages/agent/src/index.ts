import type { LlmChatResponse, Message, Profile, StreamingChatHandler } from '@snapdragon-ai/host';
import { codingToolsets, replToolset, ToolRegistry } from '@snapdragon-ai/tools';
import { parseToolArgs } from './tool-args.js';
import type {
  AgentEvent,
  AgentEventListener,
  AgentOptions,
  AgentPromptInput,
  AgentSession,
  CodingAgentOptions,
  PromptOptions,
  SnapdragonAgentArgs,
} from './types.js';

export type {
  AgentEvent,
  AgentEventListener,
  AgentOptions,
  AgentPromptInput,
  AgentSession,
  CodingAgentOptions,
  PromptOptions,
  SnapdragonAgentArgs,
} from './types.js';

export class SnapdragonAgent {
  readonly messages: Message[] = [];
  readonly registry: ToolRegistry;
  readonly cwd: string;
  #provider: StreamingChatHandler;
  #systemPrompt: string;
  #profile?: Profile;
  #maxTurns: number;
  #temperature?: number;
  #maxTokens?: number;
  #session?: AgentSession;
  #listeners = new Set<AgentEventListener>();

  private constructor(args: SnapdragonAgentArgs) {
    this.#provider = args.provider;
    this.cwd = args.cwd;
    this.registry = args.registry;
    this.#systemPrompt = args.systemPrompt;
    this.#profile = args.profile;
    this.#maxTurns = args.maxTurns;
    this.#temperature = args.temperature;
    this.#maxTokens = args.maxTokens;
    this.#session = args.session;
    if (args.session) this.messages.push(...args.session.messages());
  }

  static async create(options: AgentOptions): Promise<SnapdragonAgent> {
    const cwd = options.cwd ?? process.cwd();
    const registry =
      options.tools instanceof ToolRegistry ? options.tools : new ToolRegistry({ cwd });
    if (Array.isArray(options.tools)) await registry.registerMany(options.tools);

    return new SnapdragonAgent({
      provider: options.provider,
      cwd,
      registry,
      systemPrompt: options.systemPrompt ?? defaultSystemPrompt(),
      profile: options.profile,
      maxTurns: options.maxTurns ?? 32,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      session: options.session,
    });
  }

  subscribe(listener: AgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async prompt(input: AgentPromptInput, options: PromptOptions = {}): Promise<LlmChatResponse> {
    const runId = options.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.#emit({ type: 'run_start', runId });
    const userMessage: Message = { role: 'user', content: input };
    await this.#appendMessage(userMessage);
    await this.#emit({ type: 'message', message: userMessage });

    for (let turn = 0; turn < this.#maxTurns; turn += 1) {
      if (options.signal?.aborted) {
        throw new Error('Agent run aborted');
      }

      const response = await this.#provider(
        {
          role: 'assistant',
          messages: this.#requestMessages(),
          tools: this.registry.listDefinitions(),
          tool_choice: this.registry.listDefinitions().length > 0 ? 'auto' : 'none',
          temperature: this.#temperature,
          max_tokens: this.#maxTokens,
        },
        {
          runId,
          profile: this.#profile,
          emit: () => undefined,
        },
      );

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
        thinking: response.thinking,
      };
      await this.#appendMessage(assistantMessage);
      await this.#emit({ type: 'message', message: assistantMessage });

      if (!response.tool_calls || response.tool_calls.length === 0) {
        await this.#emit({ type: 'run_end', runId, response });
        return response;
      }

      for (const call of response.tool_calls) {
        await this.#emit({ type: 'tool_start', call });
        const result = await this.registry.invoke(call.name, parseToolArgs(call.args_json), {
          cwd: this.cwd,
          signal: options.signal,
        });
        const toolMessage: Message = {
          role: 'tool',
          content: result.content,
          tool_call_id: call.id,
        };
        await this.#appendMessage(toolMessage);
        await this.#emit({ type: 'message', message: toolMessage });
        await this.#emit({
          type: 'tool_end',
          call,
          content: result.content,
          isError: result.isError === true,
        });
      }
    }

    throw new Error(`Agent exceeded maxTurns=${this.#maxTurns}`);
  }

  #requestMessages(): Message[] {
    const system: Message[] =
      this.#systemPrompt.length > 0 ? [{ role: 'system', content: this.#systemPrompt }] : [];
    return [...system, ...this.messages];
  }

  async #appendMessage(message: Message): Promise<void> {
    this.messages.push(message);
    if (this.#session) await this.#session.appendMessage(message);
  }

  async #emit(event: AgentEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
  }
}

export async function createAgent(options: AgentOptions): Promise<SnapdragonAgent> {
  return SnapdragonAgent.create(options);
}

export async function createCodingReplAgent(options: CodingAgentOptions): Promise<SnapdragonAgent> {
  const cwd = options.cwd ?? process.cwd();
  const registry = new ToolRegistry({ cwd, session: codingSession(options) });
  await registry.registerMany([...codingToolsets({ cwd }), replToolset()]);
  return SnapdragonAgent.create({
    ...options,
    cwd,
    tools: registry,
    systemPrompt: options.systemPrompt ?? defaultCodingSystemPrompt(),
  });
}

function codingSession(options: CodingAgentOptions): Map<string, unknown> | undefined {
  return options.codingTools ? options.codingTools.session : undefined;
}

function defaultSystemPrompt(): string {
  return 'You are a concise, practical assistant. Use tools when they materially help.';
}

function defaultCodingSystemPrompt(): string {
  return [
    'You are a coding agent running inside a local workspace.',
    'Use the coding tools for file and shell work.',
    'Use repl_eval when programmatic inspection or repeated tool invocation would be more efficient.',
    'Keep changes scoped to the user request.',
  ].join('\n');
}
