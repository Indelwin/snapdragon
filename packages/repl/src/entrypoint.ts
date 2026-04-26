import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isDirectEntrypoint(metaUrl: string, entrypoint = process.argv[1]): boolean {
  if (!entrypoint) return false;
  try {
    return realpathSync(entrypoint) === fileURLToPath(metaUrl);
  } catch {
    return false;
  }
}
