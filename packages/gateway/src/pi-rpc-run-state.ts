import {
  assistantText,
  stringField,
  summarize,
  textDelta,
  writeOutputArtifact,
} from './pi-rpc-output.js';
import type { PiRpcAgentRunResult, PiRpcObservedEvent, PiRpcSession } from './pi-rpc-types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

const blockingExtensionUiMethods = new Set(['select', 'confirm', 'input', 'editor']);

export class PiRpcRunState {
  #content = '';
  #events: PiRpcObservedEvent[] = [];
  #extensionUiRequests = 0;
  #latestAssistantText: string | undefined;

  record(event: Record<string, unknown>, session: PiRpcSession): void {
    this.#handleExtensionUi(event, session);
    this.#appendTextDelta(event);
    this.#captureFinalAssistantText(event);
    this.#events.push({
      type: stringField(event.type, 'event'),
      atMs: Date.now(),
      payload: event,
    });
  }

  async result(
    spec: GatewayAgentRunSpec,
    state: unknown,
    durationMs: number,
  ): Promise<PiRpcAgentRunResult> {
    const content = this.#latestAssistantText ?? this.#content;
    const result = this.#baseResult(content, state, durationMs);
    if (spec.outputArtifact) {
      result.outputArtifact = await writeOutputArtifact(spec.outputArtifact, result, spec.cwd);
    }
    return result;
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
    if (delta) this.#content += delta;
  }

  #captureFinalAssistantText(event: Record<string, unknown>): void {
    if (event.type !== 'message_end') return;
    const text = assistantText(event.message);
    if (!text) return;
    this.#latestAssistantText = text;
    this.#content = text;
  }

  #baseResult(content: string, state: unknown, durationMs: number): PiRpcAgentRunResult {
    return {
      summary: summarize(content),
      content,
      events: this.#events,
      state,
      metrics: {
        duration_ms: durationMs,
        event_count: this.#events.length,
        extension_ui_requests: this.#extensionUiRequests,
      },
    };
  }
}
