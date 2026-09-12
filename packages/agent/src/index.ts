import type {
  LlmChatResponse,
  Message,
  Profile,
  ReasoningRequest,
  StreamingChatHandler,
} from '@snapdragon-ai/host';
import { codingToolsets, replToolset, type ToolRegistry } from '@snapdragon-ai/tools';
import { runAgentPrompt } from './agent-prompt.js';
import type { AgentPromptState } from './agent-prompt-types.js';
import {
  createOwnedToolRegistry,
  disposeAgentRegistry,
  prepareAgentRegistry,
} from './agent-registry.js';
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
type AgentArgsPlus = SnapdragonAgentArgs & ReasoningOptions & { ownsRegistry: boolean };

const DEFAULT_MAX_TOOL_RESULT_BYTES = 64_000;
const DEFAULT_MAX_TOOL_CALL_ARGS_BYTES = 64_000;

export { defaultCodingSystemPrompt, defaultSystemPrompt } from './prompts.js';
export {
  ContextBudgetExceededError,
  isContextBudgetExceededError,
} from './request-context-error.js';
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
  #maxToolCallArgsBytes: number;
  #maxInMemoryMessages: number | undefined;
  #context?: AgentContextOptions;
  #temperature?: number;
  #maxTokens?: number;
  #reasoning: ReasoningRequest | undefined;
  #session?: AgentSession;
  #listeners = new Set<AgentEventListener>();
  #activePrompts = new Set<Promise<unknown>>();
  #abortControllers = new Set<AbortController>();
  #disposePromise?: Promise<void>;
  #disposed = false;
  #ownsRegistry: boolean;

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
    this.#maxToolCallArgsBytes = args.maxToolCallArgsBytes;
    this.#maxInMemoryMessages = defaultInMemoryLimit(args.session, args.context);
    this.#context = args.context;
    this.#temperature = args.temperature;
    this.#maxTokens = args.maxTokens;
    this.#reasoning = args.reasoning;
    this.#session = args.session;
    this.#ownsRegistry = args.ownsRegistry;
  }

  static async create(
    options: AgentOptionsPlus,
    ownsInjectedRegistry = false,
  ): Promise<SnapdragonAgent> {
    const cwd = options.cwd ?? process.cwd();
    const { registry, owned: ownsRegistry } = await prepareAgentRegistry(
      cwd,
      options.tools,
      ownsInjectedRegistry,
    );

    return new SnapdragonAgent({
      provider: options.provider,
      cwd,
      registry,
      systemPrompt: options.systemPrompt ?? defaultSystemPrompt(),
      profile: options.profile,
      maxTurns: options.maxTurns ?? Number.POSITIVE_INFINITY,
      maxToolResultBytes: options.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES,
      maxToolCallArgsBytes: options.maxToolCallArgsBytes ?? DEFAULT_MAX_TOOL_CALL_ARGS_BYTES,
      context: options.context,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      reasoning: options.reasoning,
      session: options.session,
      ownsRegistry,
    });
  }

  subscribe(listener: AgentEventListener): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setProvider(provider: StreamingChatHandler, options: RuntimeOptions = {}): void {
    this.#provider = provider;
    if ('reasoning' in options) this.#reasoning = options.reasoning;
    if ('context' in options) {
      this.#context = options.context;
      this.#maxInMemoryMessages = defaultInMemoryLimit(this.#session, this.#context);
    }
    if ('maxTokens' in options) this.#maxTokens = options.maxTokens;
  }

  prompt(input: AgentPromptInput, options: PromptOptions = {}): Promise<LlmChatResponse> {
    if (this.#disposed) return Promise.reject(new Error('Agent is disposed.'));
    const controller = new AbortController();
    const removeAbortForwarder = forwardAbort(options.signal, controller);
    this.#abortControllers.add(controller);
    const task = runAgentPrompt(this.#promptState(), input, {
      ...options,
      signal: controller.signal,
    });
    this.#activePrompts.add(task);
    return task.finally(() => {
      removeAbortForwarder();
      this.#abortControllers.delete(controller);
      this.#activePrompts.delete(task);
    });
  }

  dispose(): Promise<void> {
    this.#disposePromise ??= this.#dispose();
    return this.#disposePromise;
  }

  async #dispose(): Promise<void> {
    this.#disposed = true;
    for (const controller of this.#abortControllers) controller.abort();
    await Promise.allSettled([...this.#activePrompts]);
    this.#listeners.clear();
    await disposeAgentRegistry(this.registry, this.#ownsRegistry);
  }

  #promptState(): AgentPromptState {
    return {
      agent: this,
      maxTurns: this.#maxTurns,
      maxToolResultBytes: this.#maxToolResultBytes,
      maxToolCallArgsBytes: this.#maxToolCallArgsBytes,
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
    signal,
  ) => sendProviderRequest(this.#providerRequestState(), replacement, tools, runId, signal);

  readonly #appendMessage: AgentPromptState['appendMessage'] = (message) =>
    appendAgentMessage({
      maxInMemoryMessages: this.#maxInMemoryMessages,
      messages: this.messages,
      session: this.#session,
      message,
    });

  readonly #emit: AgentPromptState['emit'] = (event) =>
    emitAgentEvent({ listeners: this.#listeners, event });
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  if (signal.aborted) controller.abort();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

export const createAgent = (options: AgentOptionsPlus): Promise<SnapdragonAgent> =>
  SnapdragonAgent.create(options);

export async function createCodingReplAgent(options: CodingOptions): Promise<SnapdragonAgent> {
  const cwd = options.cwd ?? process.cwd();
  const registry = await createOwnedToolRegistry({ cwd, session: codingSession(options) }, [
    ...codingToolsets({ cwd }),
    replToolset(),
  ]);
  return SnapdragonAgent.create(
    {
      ...options,
      cwd,
      tools: registry,
      systemPrompt: options.systemPrompt ?? defaultCodingSystemPrompt(),
    },
    true,
  );
}

function codingSession(options: CodingAgentOptions): Map<string, unknown> | undefined {
  return options.codingTools ? options.codingTools.session : undefined;
}

function defaultInMemoryLimit(
  session: AgentSession | undefined,
  context: AgentContextOptions | undefined,
): number | undefined {
  if (!session || !context?.enabled) return undefined;
  return Math.max(64, (context.freshTailCount ?? 32) * 2);
}
