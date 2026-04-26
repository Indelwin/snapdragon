import type { AgentEvent } from '@snapdragon-ai/agent';
import type { LlmChatResponse } from '@snapdragon-ai/host';
import type { SdIo } from './repl.js';

export class RunRenderer {
  #sawText = false;
  #sawThinking = false;
  #io: SdIo;

  constructor(io: SdIo) {
    this.#io = io;
  }

  accept(event: AgentEvent): void {
    if (event.type === 'run_start') {
      this.#sawText = false;
      this.#sawThinking = false;
      return;
    }
    if (event.type === 'tool_start') {
      this.#io.output.write(`\n[tool] ${event.call.name}\n`);
      return;
    }
    if (event.type === 'tool_end' && event.isError) {
      this.#io.error.write(`[tool-error] ${event.content}\n`);
      return;
    }
    if (event.type === 'provider_event') this.#acceptProviderEvent(event.event);
  }

  finish(response: LlmChatResponse): void {
    if (this.#sawThinking) this.#io.error.write('\n');
    if (this.#sawText) {
      this.#io.output.write('\n');
      return;
    }
    if (response.content) this.#io.output.write(`${response.content}\n`);
  }

  #acceptProviderEvent(event: Extract<AgentEvent, { type: 'provider_event' }>['event']): void {
    if (event.kind === 'text') {
      this.#sawText = true;
      this.#io.output.write(event.delta);
    } else if (event.kind === 'thinking') {
      if (!this.#sawThinking) this.#io.error.write('\n[thinking] ');
      this.#sawThinking = true;
      this.#io.error.write(event.delta);
    } else if (event.kind === 'error') {
      this.#io.error.write(`[provider-error] ${event.message}\n`);
    }
  }
}
