import { readFileSync, writeFileSync } from 'node:fs';
import { SD_RESTART_REQUEST_PATH_ENV } from './cli-restart-state.js';
import { parseRestartState } from './cli-restart-state-validation.js';
import type { SdRestartRequest } from './reload.js';

export function writeRestartRequest(
  request: SdRestartRequest,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = env[SD_RESTART_REQUEST_PATH_ENV];
  if (!path) throw new Error('Restart request path is unavailable outside the CLI supervisor.');
  writeFileSync(path, `${JSON.stringify(request)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function readRestartRequest(path: string): SdRestartRequest {
  let parsed: SdRestartRequest;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as SdRestartRequest;
  } catch (error) {
    throw new Error(
      `CLI child requested restart without valid state: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed.kind !== 'restart' || parsed.reason !== 'executable_reload') {
    throw new Error('CLI child returned an unsupported restart request.');
  }
  return { ...parsed, state: parseRestartState(parsed.state) };
}
