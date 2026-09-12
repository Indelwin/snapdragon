import { outputArtifactPath, writeOutputArtifact } from './pi-rpc-artifacts.js';
import { PiRpcEventBuffer } from './pi-rpc-event-buffer.js';
import { stringField } from './pi-rpc-output.js';
import { buildPiRpcResult } from './pi-rpc-result.js';
import { PiRpcRunProjection } from './pi-rpc-run-projection.js';
import { PiRpcTraces } from './pi-rpc-traces.js';
import type {
  PiRpcAgentRunResult,
  PiRpcObservedEvent,
  PiRpcObserverContext,
  PiRpcSession,
  PiRpcTraceSink,
} from './pi-rpc-types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

export {
  MAX_PI_RESULT_EVENT_BYTES,
  MAX_PI_RESULT_EVENTS,
  MAX_PI_RESULT_SINGLE_EVENT_BYTES,
} from './pi-rpc-event-buffer.js';
export {
  MAX_PI_RESULT_CONTENT_BYTES,
  MAX_PI_RESULT_STATE_BYTES,
} from './pi-rpc-run-projection.js';

export class PiRpcRunState {
  readonly #projection = new PiRpcRunProjection();
  readonly #events = new PiRpcEventBuffer();
  readonly #traces = new PiRpcTraces();
  #observerErrors = 0;

  async initialize(spec: GatewayAgentRunSpec, traceSink?: PiRpcTraceSink): Promise<void> {
    await this.#traces.initialize(spec, traceSink);
  }

  record(event: Record<string, unknown>, session: PiRpcSession): PiRpcObservedEvent {
    this.#projection.record(event, session);
    const observed = {
      type: stringField(event.type, 'event'),
      atMs: Date.now(),
      payload: event,
    };
    this.#events.retain(observed);
    return observed;
  }

  async persist(observed: PiRpcObservedEvent, context: PiRpcObserverContext): Promise<void> {
    await this.#traces.persist(observed, context);
  }

  recordObserverError(): void {
    this.#observerErrors += 1;
  }

  async close(context: PiRpcObserverContext): Promise<void> {
    await this.#traces.close(context);
  }

  async result(spec: GatewayAgentRunSpec, durationMs: number): Promise<PiRpcAgentRunResult> {
    const sinkError = this.#traces.firstError();
    if (sinkError) throw new Error(`Pi RPC trace sink failed: ${sinkError.message}`);
    const result = buildPiRpcResult(
      this.#projection,
      this.#events,
      durationMs,
      this.#observerErrors,
      this.#traces.errorCount(),
    );
    const traces = this.#traces.artifacts();
    if (spec.outputArtifact) {
      result.outputArtifact = outputArtifactPath(spec.outputArtifact, spec.cwd);
    }
    if (result.outputArtifact || traces.length > 0) {
      result.artifacts = { result: result.outputArtifact, traces };
    }
    if (spec.outputArtifact) {
      await writeOutputArtifact(spec.outputArtifact, result, spec.cwd);
    }
    return result;
  }
}
