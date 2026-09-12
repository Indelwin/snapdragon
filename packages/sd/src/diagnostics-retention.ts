import { opendir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SdDiagnosticsWriterSettings } from './diagnostics-settings.js';

export async function pruneDiagnosticsFiles(settings: SdDiagnosticsWriterSettings): Promise<void> {
  const directory = await opendir(settings.directory);
  for await (const entry of directory) {
    const match = /^metrics(?:\.(\d+))?\.jsonl$/.exec(entry.name);
    if (!match) continue;
    const path = join(settings.directory, entry.name);
    const index = Number(match[1] ?? 0);
    if (index >= settings.maxFiles || (await currentSize(path)) > settings.maxFileBytes) {
      await rm(path, { force: true });
    }
  }
}

export async function currentSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
}

export function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
