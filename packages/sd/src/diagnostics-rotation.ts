import { appendFile, chmod, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { currentSize, isMissing, pruneDiagnosticsFiles } from './diagnostics-retention.js';
import type { SdDiagnosticsSampleContext } from './diagnostics-sample.js';
import { collectDiagnosticsSample } from './diagnostics-sample.js';
import type { SdDiagnosticsWriterSettings } from './diagnostics-settings.js';

export async function writeDiagnosticsSample(
  settings: SdDiagnosticsWriterSettings,
  context: SdDiagnosticsSampleContext,
): Promise<void> {
  const line = `${JSON.stringify(collectDiagnosticsSample(context))}\n`;
  await mkdir(settings.directory, { recursive: true, mode: 0o700 });
  await pruneDiagnosticsFiles(settings);
  if ((await currentSize(settings.path)) + Buffer.byteLength(line) > settings.maxFileBytes) {
    await rotate(settings);
  }
  await appendFile(settings.path, line, { encoding: 'utf8', mode: 0o600 });
  await chmod(settings.path, 0o600);
}

async function rotate(settings: SdDiagnosticsWriterSettings): Promise<void> {
  if (settings.maxFiles === 1) {
    await rm(settings.path, { force: true });
    return;
  }
  await rm(rotatedPath(settings, settings.maxFiles - 1), { force: true });
  for (let index = settings.maxFiles - 2; index >= 1; index -= 1) {
    await renameIfPresent(rotatedPath(settings, index), rotatedPath(settings, index + 1));
  }
  await renameIfPresent(settings.path, rotatedPath(settings, 1));
}

function rotatedPath(settings: SdDiagnosticsWriterSettings, index: number): string {
  return join(settings.directory, `metrics.${index}.jsonl`);
}

async function renameIfPresent(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
