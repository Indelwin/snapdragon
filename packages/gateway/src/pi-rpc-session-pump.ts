import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { boundedJsonLines } from './pi-rpc-framer.js';
import { parseJsonLine } from './pi-rpc-json.js';
import type { PiRpcObserverContext, PiRpcResponse } from './pi-rpc-types.js';

export type PiRpcEventListener = (
  event: Record<string, unknown>,
  context: PiRpcObserverContext,
) => void | Promise<void>;

export async function pumpPiRpcLines(
  child: ChildProcessWithoutNullStreams,
  maxLineBytes: number,
  pending: Map<string, (response: PiRpcResponse) => void>,
  listeners: Set<PiRpcEventListener>,
  signal: AbortSignal,
): Promise<void> {
  for await (const line of boundedJsonLines(child.stdout, maxLineBytes)) {
    if (signal.aborted) break;
    await dispatchJsonLine(line, pending, listeners, signal);
  }
}

async function dispatchJsonLine(
  line: string,
  pending: Map<string, (response: PiRpcResponse) => void>,
  listeners: Set<PiRpcEventListener>,
  signal: AbortSignal,
): Promise<void> {
  const parsed = parseJsonLine(line);
  if (!parsed) return;
  if (parsed.type === 'response' && typeof parsed.id === 'string') {
    resolvePendingResponse(parsed, pending);
    return;
  }
  for (const listener of [...listeners]) {
    await invokeListener(listener, parsed, signal);
  }
}

async function invokeListener(
  listener: PiRpcEventListener,
  event: Record<string, unknown>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  let task: Promise<void>;
  try {
    task = Promise.resolve(listener(event, { signal }));
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', finish);
      resolve();
    };
    signal.addEventListener('abort', finish, { once: true });
    task.then(finish, finish);
    if (signal.aborted) finish();
  });
}

function resolvePendingResponse(
  parsed: Record<string, unknown>,
  pending: Map<string, (response: PiRpcResponse) => void>,
): void {
  const resolvePending = pending.get(String(parsed.id));
  if (!resolvePending) return;
  pending.delete(String(parsed.id));
  resolvePending(parsed as PiRpcResponse);
}
