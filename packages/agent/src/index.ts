import type {
  LlmChatResponse,
  Message,
  Profile,
  ReasoningRequest,
  StreamingChatHandler,
} from '@snapdragon-ai/host';
import { codingToolsets, replToolset, ToolRegistry } from '@snapdragon-ai/tools';
import { type AgentEvent, type AgentEventListener, emitProviderEvent } from './events.js';
import { defaultCodingSystemPrompt, defaultSystemPrompt } from './prompts.js';
import { parseToolArgs } from './tool-args.js';
import type {
  AgentContextOptions,
  AgentOptions,
  AgentPromptInput,
  AgentSession,
  CodingAgentOptions,
  PromptOptions,
  SnapdragonAgentArgs,
} from './types.js';

type ReasoningOptions = Partial<Record<'reasoning', ReasoningRequest>>;
type AgentOptionsPlus = AgentOptions & ReasoningOptions;
type CodingOptions = CodingAgentOptions & ReasoningOptions;
type AgentArgsPlus = SnapdragonAgentArgs & ReasoningOptions;

const DEFAULT_MAX_TOOL_RESULT_BYTES = 64_000;

export { defaultCodingSystemPrompt, defaultSystemPrompt } from './prompts.js';
export type * from './types.js';

export class SnapdragonAgent {
  readonly messages: Message[] = [];
  readonly registry: ToolRegistry;
  readonly cwd: string;
  #provider: StreamingChatHandler;
  #systemPrompt: string;
  #profile?: Profile;
  #maxTurns: number;
  #maxToolResultBytes: number;
  #context?: AgentContextOptions;
  #temperature?: number;
  #maxTokens?: number;
  #reasoning: ReasoningRequest | undefined;
  #session?: AgentSession;
  #listeners = new Set<AgentEventListener>();

  private constructor(args: AgentArgsPlus) {
    this.#provider = args.provider;
    this.cwd = args.cwd;
    this.registry = args.registry;
    this.#systemPrompt = args.systemPrompt;
    this.#profile = args.profile;
    this.#maxTurns = args.maxTurns;
    this.#maxToolResultBytes = args.maxToolResultBytes;
    this.#context = args.context;
    this.#temperature = args.temperature;
    this.#maxTokens = args.maxTokens;
    this.#reasoning = args.reasoning;
    this.#session = args.session;
    if (args.session) this.messages.push(...args.session.messages());
  }

  static async create(options: AgentOptionsPlus): Promise<SnapdragonAgent> {
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
      maxTurns: options.maxTurns ?? Number.POSITIVE_INFINITY,
      maxToolResultBytes: options.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES,
      context: options.context,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      reasoning: options.reasoning,
      session: options.session,
    });
  }

  subscribe(listener: AgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setProvider(provider: StreamingChatHandler, options: ReasoningOptions = {}): void {
    this.#provider = provider;
    if ('reasoning' in options) this.#reasoning = options.reasoning;
  }

  async prompt(input: AgentPromptInput, options: PromptOptions = {}): Promise<LlmChatResponse> {
    const runId = options.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.#emit({ type: 'run_start', runId });
    const userMessage: Message = { role: 'user', content: input };
    const requestUserMessage: Message =
      options.requestInput === undefined
        ? userMessage
        : { ...userMessage, content: options.requestInput };
    await this.#appendMessage(userMessage);
    await this.#emit({ type: 'message', message: userMessage });

    for (let turn = 0; turn < this.#maxTurns; turn += 1) {
      if (options.signal?.aborted) {
        throw new Error('Agent run aborted');
      }

      const response = await this.#provider(
        {
          role: 'assistant',
          messages: await this.#requestMessages({
            visible: userMessage,
            request: requestUserMessage,
          }),
          tools: this.registry.listDefinitions(),
          tool_choice: this.registry.listDefinitions().length > 0 ? 'auto' : 'none',
          temperature: this.#temperature,
          max_tokens: this.#maxTokens,
          reasoning: this.#reasoning,
        },
        {
          runId,
          profile: this.#profile,
          emit: (event) => emitProviderEvent(this.#listeners, event),
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
        const toolContent = clampToolResult(result.content, this.#maxToolResultBytes);
        const toolMessage: Message = {
          role: 'tool',
          content: toolContent,
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

  async #requestMessages(replacement?: { visible: Message; request: Message }): Promise<Message[]> {
    const system: Message[] =
      this.#systemPrompt.length > 0 ? [{ role: 'system', content: this.#systemPrompt }] : [];
    await this.#compactContext();
    const contextMessages = await this.#contextMessages();
    const messages = replacement
      ? replaceVisibleMessage(contextMessages, replacement)
      : contextMessages;
    return [...system, ...messages];
  }

  async #compactContext(): Promise<void> {
    if (!this.#context?.enabled || !this.#session?.compactContext) return;
    await this.#session.compactContext(this.#context);
  }

  async #contextMessages(): Promise<Message[]> {
    if (!this.#context?.enabled || !this.#session?.assembleContext) return this.messages;
    return this.#session.assembleContext(this.#context);
  }

  async #appendMessage(message: Message): Promise<void> {
    this.messages.push(message);
    if (this.#session) await this.#session.appendMessage(message);
  }

  async #emit(event: AgentEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
  }
}

export async function createAgent(options: AgentOptionsPlus): Promise<SnapdragonAgent> {
  return SnapdragonAgent.create(options);
}

export async function createCodingReplAgent(options: CodingOptions): Promise<SnapdragonAgent> {
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

function clampToolResult(content: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return content;
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content;
  const slice = Buffer.from(content, 'utf8').subarray(0, Math.floor(maxBytes)).toString('utf8');
  return `${slice}\n[tool result truncated to ${Math.floor(maxBytes)} bytes]`;
}

function replaceVisibleMessage(
  messages: Message[],
  replacement: { visible: Message; request: Message },
): Message[] {
  const index = findEquivalentMessageIndex(messages, replacement.visible);
  if (index < 0) return messages;
  const out = messages.slice();
  out[index] = replacement.request;
  return out;
}

function findEquivalentMessageIndex(messages: Message[], target: Message): number {
  const targetContent = JSON.stringify(target.content);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate.role === target.role && JSON.stringify(candidate.content) === targetContent) {
      return index;
    }
  }
  return -1;
}
