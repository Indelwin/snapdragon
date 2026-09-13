import type { createInterface } from 'node:readline/promises';

export async function askReplQuestion(
  rl: ReturnType<typeof createInterface>,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!signal) return rl.question('sd> ');
  try {
    return await rl.question('sd> ', { signal });
  } catch (error) {
    if (signal.aborted) return '';
    throw error;
  }
}
