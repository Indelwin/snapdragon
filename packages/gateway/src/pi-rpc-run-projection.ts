import { assistantText, textDelta } from './pi-rpc-output.js';
import { boundedJsonProjection } from './pi-rpc-projection.js';
import { BoundedTextPreview } from './pi-rpc-text-preview.js';
import type { PiRpcRetentionStats, PiRpcSession } from './pi-rpc-types.js';

const blockingExtensionUiMethods = new Set(['select', 'confirm', 'input', 'editor']);
export const MAX_PI_RESULT_CONTENT_BYTES = 256 * 1024;
export const MAX_PI_RESULT_STATE_BYTES = 256 * 1024;

export class PiRpcRunProjection {
  readonly #content = new BoundedTextPreview(MAX_PI_RESULT_CONTENT_BYTES);
  #extensionUiRequests = 0;
  #state: unknown;
  #stateStats: PiRpcRetentionStats = {
    truncated: false,
    originalBytes: 0,
    retainedBytes: 0,
  };

  record(event: Record<string, unknown>, session: PiRpcSession): void {
    this.#handleExtensionUi(event, session);
    this.#appendTextDelta(event);
    this.#captureFinalAssistantText(event);
    this.#captureAgentState(event);
  }

  content(): string {
    return this.#content.value();
  }

  contentStats(): PiRpcRetentionStats {
    return this.#content.stats();
  }

  state(): unknown {
    return this.#state;
  }

  stateStats(): PiRpcRetentionStats {
    return this.#stateStats;
  }

  extensionUiRequests(): number {
    return this.#extensionUiRequests;
  }

  #handleExtensionUi(event: Record<string, unknown>, session: PiRpcSession): void {
    if (event.type !== 'extension_ui_request') return;
    this.#extensionUiRequests += 1;
    const id = typeof event.id === 'string' ? event.id : undefined;
    const method = typeof event.method === 'string' ? event.method : undefined;
    if (!id || !method || !blockingExtensionUiMethods.has(method)) return;
    session.write({ type: 'extension_ui_response', id, cancelled: true });
  }

  #appendTextDelta(event: Record<string, unknown>): void {
    if (event.type !== 'message_update') return;
    const delta = textDelta(event);
    if (delta) this.#content.append(delta);
  }

  #captureFinalAssistantText(event: Record<string, unknown>): void {
    if (event.type !== 'message_end') return;
    const text = assistantText(event.message);
    if (text) this.#content.replace(text);
  }

  #captureAgentState(event: Record<string, unknown>): void {
    if (event.type !== 'agent_end') return;
    const projection = boundedJsonProjection(event.messages, MAX_PI_RESULT_STATE_BYTES);
    this.#state = projection.value;
    this.#stateStats = projection.stats;
  }
}
