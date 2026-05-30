import { requestId } from './pi-rpc-output.js';
import { startPiRpcSession } from './pi-rpc-process.js';
import { PiRpcRunState } from './pi-rpc-run-state.js';
import {
  DEFAULT_TIMEOUT_MS,
  type PiRpcAgentJobOptions,
  type PiRpcAgentRunResult,
  type PiRpcRuntimeOptions,
  type PiRpcSession,
} from './pi-rpc-types.js';
import type { GatewayAgentRunSpec } from './types-runtime.js';

export class PiRpcRunController {
  readonly #runState = new PiRpcRunState();
  #session?: PiRpcSession;

  constructor(
    private readonly spec: GatewayAgentRunSpec,
    private readonly options: PiRpcAgentJobOptions,
  ) {}

  async run(): Promise<PiRpcAgentRunResult> {
    if (!this.spec.prompt.trim()) throw new Error('Pi RPC agent job requires a prompt');
    this.#session = startPiRpcSession(this.options, this.spec, this.options.descriptor);
    this.#session.onEvent((event) => this.#runState.record(event, this.#requireSession()));
    const startedAtMs = Date.now();
    const agentEnd = this.#waitForAgentEnd();
    try {
      await this.#sendPrompt();
      const state = await agentEnd;
      return this.#runState.result(this.spec, state, Date.now() - startedAtMs);
    } catch (error) {
      agentEnd.catch(() => undefined);
      throw error;
    } finally {
      await this.#requireSession().stop();
    }
  }

  async #sendPrompt(): Promise<void> {
    const response = await this.#requireSession().send({
      type: 'prompt',
      message: this.spec.prompt,
    });
    if (response.success === false) throw new Error(response.error ?? 'Pi RPC prompt failed');
  }

  async #waitForAgentEnd(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = this.#agentTimeout(reject);
      const abort = this.#abortHandler(timeout, reject);
      const session = this.#requireSession();
      this.options.signal?.addEventListener('abort', abort, { once: true });
      session.onEvent((event) => this.#resolveAgentEnd(event, timeout, abort, resolve));
      session.child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        this.options.signal?.removeEventListener('abort', abort);
        reject(new Error(exitBeforeEndMessage(code, signal)));
      });
    });
  }

  #agentTimeout(reject: (error: Error) => void): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      reject(new Error(`Pi RPC agent run timed out after ${timeoutMs(this.options)}ms`));
      void this.#session?.stop();
    }, timeoutMs(this.options));
  }

  #abortHandler(
    timeout: ReturnType<typeof setTimeout>,
    reject: (error: Error) => void,
  ): () => void {
    return () => {
      clearTimeout(timeout);
      this.#session?.write({ id: requestId('abort'), type: 'abort' });
      reject(new Error('Pi RPC agent run aborted'));
      void this.#session?.stop();
    };
  }

  #resolveAgentEnd(
    event: Record<string, unknown>,
    timeout: ReturnType<typeof setTimeout>,
    abort: () => void,
    resolve: (state: unknown) => void,
  ): void {
    if (event.type !== 'agent_end') return;
    clearTimeout(timeout);
    this.options.signal?.removeEventListener('abort', abort);
    resolve(event.messages);
  }

  #requireSession(): PiRpcSession {
    if (!this.#session) throw new Error('Pi RPC session was not started');
    return this.#session;
  }
}

function timeoutMs(options: PiRpcRuntimeOptions): number {
  return options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

function exitBeforeEndMessage(code: number | null, signal: NodeJS.Signals | null): string {
  return `Pi RPC process exited before agent_end code=${code ?? 'null'} signal=${signal ?? 'null'}`;
}
