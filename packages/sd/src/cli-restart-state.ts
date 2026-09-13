import { parseRestartState } from './cli-restart-state-validation.js';
import type { SdRestartState } from './reload.js';

export const SD_SUPERVISED_ENV = 'SNAPDRAGON_SD_SUPERVISED';
export const SD_RESTART_STATE_ENV = 'SNAPDRAGON_SD_RESTART_STATE';
export const SD_RESTART_REQUEST_PATH_ENV = 'SNAPDRAGON_SD_RESTART_REQUEST_PATH';

export function restartStateFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): SdRestartState | undefined {
  const encoded = env[SD_RESTART_STATE_ENV];
  if (!encoded) return undefined;
  return parseRestartState(JSON.parse(encoded));
}

export function childRestartEnvironment(
  base: NodeJS.ProcessEnv,
  requestPath: string,
  state: SdRestartState | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    [SD_SUPERVISED_ENV]: '1',
    [SD_RESTART_REQUEST_PATH_ENV]: requestPath,
  };
  if (state) env[SD_RESTART_STATE_ENV] = JSON.stringify(state);
  else delete env[SD_RESTART_STATE_ENV];
  return env;
}
