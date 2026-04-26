import { type StreamEmit, type StreamEvent, topicFor } from './stream/events.js';
import type {
  CapabilityHandler,
  EventListener,
  LlmChatRequest,
  LlmChatResponse,
  Message,
  Profile,
} from './types.js';

export interface StreamContext {
  runId: string;
  profile?: Profile;
  emit: StreamEmit;
}

export type StreamingChatHandler = (
  request: LlmChatRequest,
  context: StreamContext,
) => Promise<LlmChatResponse>;

export interface LocalCapabilityOptions {
  runId?: string;
  profile?: Profile;
  silent?: boolean;
}

export class Registry {
  #caps = new Map<string, CapabilityHandler>();
  #listeners: Array<{ prefix: string; listener: EventListener }> = [];
  #llmChatHandler?: StreamingChatHandler;
  #currentRunId?: string;
  #currentProfile?: Profile;

  provide<Req = unknown, Resp = unknown>(
    capability: string,
    handler: CapabilityHandler<Req, Resp>,
  ): this {
    this.#caps.set(capability, handler as CapabilityHandler);
    return this;
  }

  provideLlmChat(handler: StreamingChatHandler): this {
    this.#llmChatHandler = handler;
    this.#caps.delete('llm.chat@1');
    return this;
  }

  setCurrentRun(runId: string | undefined, profile: Profile | undefined): void {
    this.#currentRunId = runId;
    this.#currentProfile = profile;
  }

  on(topicPrefix: string, listener: EventListener): () => void {
    const entry = { prefix: topicPrefix, listener };
    this.#listeners.push(entry);
    return () => {
      const idx = this.#listeners.indexOf(entry);
      if (idx >= 0) this.#listeners.splice(idx, 1);
    };
  }

  emit(topic: string, payload: unknown): void {
    for (const { prefix, listener } of this.#listeners) {
      if (topic === prefix || topic.startsWith(prefix)) {
        listener(payload, topic);
      }
    }
  }

  async callCapability<Resp = unknown>(
    capability: string,
    request: unknown,
    options: LocalCapabilityOptions = {},
  ): Promise<Resp> {
    if (capability === 'llm.chat@1') {
      return (await this.#runStreamingChat(request as LlmChatRequest, options)) as Resp;
    }

    const handler = this.#caps.get(capability);
    if (!handler) {
      return { error: 'capability_not_provided', capability } as Resp;
    }

    return (await handler(request, {
      cap: capability,
      runId: options.runId ?? this.#currentRunId,
      profile: options.profile ?? this.#currentProfile,
    })) as Resp;
  }

  async chat(
    role: string,
    messages: Message[],
    options: LocalCapabilityOptions = {},
  ): Promise<string> {
    const response = await this.#runStreamingChat({ role, messages }, options);
    return response.content;
  }

  listCapabilities(): string[] {
    const caps = [...this.#caps.keys()];
    if (this.#llmChatHandler) caps.push('llm.chat@1');
    return caps.sort();
  }

  async #runStreamingChat(
    request: LlmChatRequest,
    options: LocalCapabilityOptions,
  ): Promise<LlmChatResponse> {
    if (!this.#llmChatHandler) {
      throw new Error('llm.chat@1 not provided');
    }

    const runId =
      options.runId ??
      this.#currentRunId ??
      `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let sawDone = false;
    const emit: StreamEmit = (event: StreamEvent) => {
      if (event.kind === 'done') sawDone = true;
      if (!options.silent) this.emit(topicFor(event), event);
    };

    const response = await this.#llmChatHandler(request, {
      runId,
      profile: options.profile ?? this.#currentProfile,
      emit,
    });
    if (!sawDone) {
      emit({ kind: 'done', run_id: runId, provider: 'unknown', response });
    }
    return response;
  }
}
