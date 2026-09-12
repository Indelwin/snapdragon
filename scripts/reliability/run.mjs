import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const inkTests = (await readdir('packages/ink/test'))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => `packages/ink/test/${name}`);
await run(process.execPath, ['--test', ...inkTests]);
const sdTests = (await readdir('packages/sd/test'))
  .filter((name) =>
    /^(?:mouse-input-adapter|tui-lifecycle|doctor|diagnostics|cli-environment).*\.test\.ts$/.test(
      name,
    ),
  )
  .map((name) => `packages/sd/test/${name}`);
await run(process.execPath, ['--import', 'tsx', '--test', ...sdTests]);
await run(
  process.execPath,
  ['--expose-gc', '--max-old-space-size=512', 'scripts/reliability/tui-soak.mjs'],
  {
    NODE_ENV: 'production',
    SD_SOAK_FRAMES: '10000',
    SD_SOAK_SECONDS: '0',
  },
);

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed: ${signal ?? code}`));
    });
  });
}
