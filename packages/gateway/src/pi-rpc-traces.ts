import { createTraceArtifactSink } from './pi-rpc-artifacts.js';
import { settleObserver } from './pi-rpc-observer.js';
import type { PiRpcObservedEvent, PiRpcObserverContext, PiRpcTraceSink } from './pi-rpc-types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

export class PiRpcTraces {
  readonly #sinks: PiRpcTraceSink[] = [];
  readonly #failedSinks = new Set<PiRpcTraceSink>();
  readonly #errors: Error[] = [];
  #closed = false;

  async initialize(spec: GatewayAgentRunSpec, traceSink?: PiRpcTraceSink): Promise<void> {
    if (traceSink) this.#sinks.push(traceSink);
    if (spec.outputArtifact) {
      this.#sinks.push(await createTraceArtifactSink(spec.outputArtifact, spec.cwd));
    }
  }

  async persist(observed: PiRpcObservedEvent, context: PiRpcObserverContext): Promise<void> {
    for (const sink of this.#sinks) {
      if (this.#failedSinks.has(sink)) continue;
      const outcome = await settleObserver(writeTrace(sink, observed, context), context.signal);
      if (outcome instanceof Error) {
        this.#failedSinks.add(sink);
        this.#errors.push(outcome);
      }
      if (context.signal.aborted) return;
    }
  }

  async close(context: PiRpcObserverContext): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const sink of this.#sinks) {
      if (!sink.close) continue;
      const outcome = await settleObserver(closeTrace(sink, context), context.signal);
      if (outcome instanceof Error) this.#errors.push(outcome);
    }
  }

  artifacts(): string[] {
    return this.#sinks.flatMap((sink) => (sink.artifact ? [sink.artifact] : []));
  }

  firstError(): Error | undefined {
    return this.#errors[0];
  }

  errorCount(): number {
    return this.#errors.length;
  }
}

async function writeTrace(
  sink: PiRpcTraceSink,
  event: PiRpcObservedEvent,
  context: PiRpcObserverContext,
): Promise<void> {
  await sink.write(event, context);
}

async function closeTrace(sink: PiRpcTraceSink, context: PiRpcObserverContext): Promise<void> {
  await sink.close?.(context);
}
