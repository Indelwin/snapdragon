const TRANSIENT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

export function transientProviderRetryDelayMs(error: unknown, attempt: number): number | undefined {
  if (!isTransientProviderError(error)) return undefined;
  return TRANSIENT_RETRY_DELAYS_MS[attempt];
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };

    function finish(): void {
      signal?.removeEventListener('abort', abort);
      resolve();
    }

    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isTransientProviderError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b(429|500|502|503|504)\b/.test(message) ||
    /(?:fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR|socket hang up)/i.test(message)
  );
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}
