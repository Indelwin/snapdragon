const TRANSIENT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

export function transientProviderRetryDelayMs(error: unknown, attempt: number): number | undefined {
  if (!isTransientProviderError(error)) return undefined;
  return TRANSIENT_RETRY_DELAYS_MS[attempt];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b(429|500|502|503|504)\b/.test(message) ||
    /(?:fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR|socket hang up)/i.test(message)
  );
}
