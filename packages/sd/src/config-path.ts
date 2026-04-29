import { existsSync } from 'node:fs';

export function configPathForLoad(path: string, fallbackPath: string, defaultPath: string): string {
  if (path !== defaultPath) return path;
  if (existsSync(path)) return path;
  if (existsSync(fallbackPath)) return fallbackPath;
  return path;
}
