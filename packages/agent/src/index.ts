import type {
  LlmChatResponse,
  Message,
  Profile,
  ReasoningRequest,
  StreamingChatHandler,
} from '@snapdragon-ai/host';
import { codingToolsets, replToolset, ToolRegistry } from '@snapdragon-ai/tools';
import { runAgentPrompt } from './agent-prompt.js';
import type { AgentPromptState } from './agent-prompt-types.js';
import { appendAgentMessage, appendAgentMeta, emitAgentEvent } from './agent-state.js';
import type { AgentEventListener } from './events.js';
import { defaultCodingSystemPrompt, defaultSystemPrompt } from './prompts.js';
import { sendProviderRequest } from './provider-request.js';
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
type RuntimeOptions = ReasoningOptions & Partial<Pick<AgentOptions, 'context' | 'maxTokens'>>;
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

  get listeners(): Set<AgentEventListener> {
    return this.#listeners;
  }

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

  setProvider(provider: StreamingChatHandler, options: RuntimeOptions = {}): void {
    this.#provider = provider;
    if ('reasoning' in options) this.#reasoning = options.reasoning;
    if ('context' in options) this.#context = options.context;
    if ('maxTokens' in options) this.#maxTokens = options.maxTokens;
  }

  prompt(input: AgentPromptInput, options: PromptOptions = {}): Promise<LlmChatResponse> {
    return runAgentPrompt(this.#promptState(), input, options);
  }

  #promptState(): AgentPromptState {
    return {
      agent: this,
      maxTurns: this.#maxTurns,
      maxToolResultBytes: this.#maxToolResultBytes,
      appendMessage: this.#appendMessage,
      appendMeta: (meta) => appendAgentMeta({ session: this.#session, meta }),
      emit: this.#emit,
      sendProviderRequest: this.#sendProviderRequest,
    };
  }

  #providerRequestState() {
    return {
      provider: this.#provider,
      listeners: this.#listeners,
      profile: this.#profile,
      context: this.#context,
      session: this.#session,
      fallbackMessages: this.messages,
      systemPrompt: this.#systemPrompt,
      temperature: this.#temperature,
      maxTokens: this.#maxTokens,
      reasoning: this.#reasoning,
    };
  }

  readonly #sendProviderRequest: AgentPromptState['sendProviderRequest'] = (
    replacement,
    tools,
    runId,
  ) => sendProviderRequest(this.#providerRequestState(), replacement, tools, runId);

  readonly #appendMessage: AgentPromptState['appendMessage'] = (message) =>
    appendAgentMessage({ messages: this.messages, session: this.#session, message });

  readonly #emit: AgentPromptState['emit'] = (event) =>
    emitAgentEvent({ listeners: this.#listeners, event });
}

export const createAgent = SnapdragonAgent.create;

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
