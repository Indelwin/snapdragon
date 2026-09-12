import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
await run(['run', 'build', '--workspaces', '--if-present']);
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
let checks = 0;
for (const workspace of manifest.workspaces) {
  const pkg = JSON.parse(await readFile(resolve(root, workspace, 'package.json'), 'utf8'));
  for (const name of Object.keys(pkg.scripts ?? {}).filter((name) =>
    /^test:reliability(?::|$)/.test(name),
  )) {
    await run(['run', name, '--workspace', pkg.name]);
    checks += 1;
  }
}
if (checks === 0) throw new Error('No workspace reliability checks registered');
console.log(`Reliability: ${checks} workspace check(s) passed`);

function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('npm', args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`npm ${args.join(' ')} failed: ${signal ?? code}`));
    });
  });
}
