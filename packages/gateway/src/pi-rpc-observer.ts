export async function settleObserver(
  task: Promise<void>,
  signal: AbortSignal,
): Promise<Error | undefined> {
  if (signal.aborted) {
    task.catch(() => undefined);
    return undefined;
  }
  return new Promise((resolve) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', onAbort);
      resolve(error);
    };
    const onAbort = () => finish();
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      () => finish(),
      (cause: unknown) => finish(cause instanceof Error ? cause : new Error(String(cause))),
    );
  });
}
