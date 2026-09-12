import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSupervisedChild } from './cli-child-process.js';
import { readRestartRequest } from './cli-restart-request.js';
import { childRestartEnvironment } from './cli-restart-state.js';
import type { SdRestartState } from './reload.js';

export { writeRestartRequest } from './cli-restart-request.js';
export {
  restartStateFromEnvironment,
  SD_RESTART_REQUEST_PATH_ENV,
  SD_RESTART_STATE_ENV,
  SD_SUPERVISED_ENV,
} from './cli-restart-state.js';

export const SD_RESTART_EXIT_CODE = 75;

export interface SdCliSupervisorOptions {
  entrypoint: string;
  env?: NodeJS.ProcessEnv;
  runChild?: (argv: string[], env: NodeJS.ProcessEnv) => Promise<number>;
}

export async function superviseSdCli(
  argv: string[],
  options: SdCliSupervisorOptions,
): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), 'snapdragon-sd-supervisor-'));
  const requestPath = join(root, 'restart.json');
  const runChild = options.runChild ?? spawnSupervisedChild(options.entrypoint);
  let state: SdRestartState | undefined;
  try {
    while (true) {
      const env = childRestartEnvironment(options.env ?? process.env, requestPath, state);
      const code = await runChild(argv, env);
      if (code !== SD_RESTART_EXIT_CODE) return code;
      state = readRestartRequest(requestPath).state;
      rmSync(requestPath, { force: true });
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}
