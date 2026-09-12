import { rename, rm, writeFile } from 'node:fs/promises';

const COMPLETION_PATH_ENV = 'SNAPDRAGON_GATEWAY_COMPLETION_PATH';

export async function writeGatewayWorkerCompletion(
  output: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = env[COMPLETION_PATH_ENV];
  if (!path) return;
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(output), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
