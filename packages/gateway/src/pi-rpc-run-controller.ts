import { settleObserver } from './pi-rpc-observer.js';
import { startPiRpcSession } from './pi-rpc-process.js';
import { PiRpcRunState } from './pi-rpc-run-state.js';
import { waitForAgentEnd } from './pi-rpc-run-wait.js';
import {
  DEFAULT_SHUTDOWN_GRACE_MS,
  type PiRpcAgentJobOptions,
  type PiRpcAgentRunResult,
  type PiRpcObservedEvent,
  type PiRpcObserverContext,
  type PiRpcSession,
} from './pi-rpc-types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

export class PiRpcRunController {
  readonly #runState = new PiRpcRunState();
  readonly #lifecycleAbort = new AbortController();
  #session?: PiRpcSession;

  constructor(
    private readonly spec: GatewayAgentRunSpec,
    private readonly options: PiRpcAgentJobOptions,
  ) {}

  async run(): Promise<PiRpcAgentRunResult> {
    if (!this.spec.prompt.trim()) throw new Error('Pi RPC agent job requires a prompt');
    if (this.options.signal?.aborted) throw new Error('Pi RPC agent run aborted');
    const startedAtMs = Date.now();
    try {
      await this.#runState.initialize(this.spec, this.options.traceSink);
      this.#session = startPiRpcSession(this.options, this.spec, this.options.descriptor);
      this.#session.onEvent((event, context) => this.#recordEvent(event, context));
      const agentEnd = waitForAgentEnd(this.#requireSession(), this.options);
      agentEnd.catch(() => undefined);
      try {
        await this.#sendPrompt();
        await agentEnd;
        return await this.#runState.result(this.spec, Date.now() - startedAtMs);
      } catch (error) {
        agentEnd.catch(() => undefined);
        throw error;
      }
    } finally {
      await this.#stop();
    }
  }

  async #sendPrompt(): Promise<void> {
    const response = await this.#requireSession().send({
      type: 'prompt',
      message: this.spec.prompt,
    });
    if (response.success === false) throw new Error(response.error ?? 'Pi RPC prompt failed');
  }

  #requireSession(): PiRpcSession {
    if (!this.#session) throw new Error('Pi RPC session was not started');
    return this.#session;
  }

  async #stop(): Promise<void> {
    try {
      await this.#session?.stop();
    } finally {
      const timer = setTimeout(
        () => this.#lifecycleAbort.abort(new Error('Pi RPC trace sink close timed out')),
        this.options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
      );
      try {
        await this.#runState.close({ signal: this.#lifecycleAbort.signal });
      } finally {
        clearTimeout(timer);
        this.#lifecycleAbort.abort(new Error('Pi RPC run stopped'));
      }
    }
  }

  async #recordEvent(
    event: Record<string, unknown>,
    context = { signal: this.#lifecycleAbort.signal },
  ): Promise<void> {
    const observed = this.#runState.record(event, this.#requireSession());
    await this.#runState.persist(observed, context);
    await this.#observe(observed, context);
    if (event.type === 'agent_end') await this.#runState.close(context);
  }

  async #observe(event: PiRpcObservedEvent, context: PiRpcObserverContext): Promise<void> {
    if (!this.options.onEvent || context.signal.aborted) return;
    let task: Promise<void>;
    try {
      task = Promise.resolve(this.options.onEvent(event, context));
    } catch {
      this.#runState.recordObserverError();
      return;
    }
    const outcome = await settleObserver(task, context.signal);
    if (outcome instanceof Error) this.#runState.recordObserverError();
  }
}
