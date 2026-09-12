import { requestId } from './pi-rpc-output.js';
import {
  DEFAULT_TIMEOUT_MS,
  type PiRpcAgentJobOptions,
  type PiRpcSession,
} from './pi-rpc-types.js';

export function waitForAgentEnd(
  session: PiRpcSession,
  options: PiRpcAgentJobOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let removeEvent: () => void = () => {};
    let removeError: () => void = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      removeEvent();
      removeError();
      if (error) reject(error);
      else resolve();
    };
    const stopSession = () => session.stop().catch(() => undefined);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      finish(new Error(`Pi RPC agent run timed out after ${timeoutMs}ms`));
      void stopSession();
    }, timeoutMs);
    const abort = () => {
      session.write({ id: requestId('abort'), type: 'abort' });
      finish(new Error('Pi RPC agent run aborted'));
      void stopSession();
    };

    removeEvent = removal(
      session.onEvent((event) => {
        if (event.type === 'agent_end') finish();
      }),
    );
    removeError = removal(session.onError?.((error) => finish(error)));
    if (settled) {
      removeEvent();
      removeError();
      return;
    }
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
  });
}

function removal(value: undefined | (() => void)): () => void {
  return typeof value === 'function' ? value : () => {};
}
