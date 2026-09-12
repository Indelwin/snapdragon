import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  fingerprintPaths,
  hashFile,
  readNamedPackageVersion,
  SD_COMPILED_FINGERPRINT_PATHS,
  SD_FINGERPRINT_EXCLUDES,
  SD_RENDERER_FINGERPRINT_PATHS,
} from '../packages/sd/dist/doctor-build.js';
import { fingerprintSdRuntimeArtifacts } from '../packages/sd/dist/doctor-runtime-fingerprint.js';
import { fingerprintSdSource } from '../packages/sd/dist/doctor-source-fingerprint.js';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = {
  sd: join(repoRoot, 'packages/sd'),
  core: join(repoRoot, 'packages/core'),
  webtools: join(repoRoot, 'packages/webtools'),
  renderer: join(repoRoot, 'packages/ink'),
};

const [
  sourceHash,
  runtimeHash,
  sdHash,
  coreHash,
  webtoolsHash,
  rendererHash,
  coreWasm,
  webtoolsWasm,
] = await Promise.all([
  fingerprintSdSource(repoRoot),
  fingerprintSdRuntimeArtifacts(roots.sd),
  fingerprintPaths(roots.sd, SD_COMPILED_FINGERPRINT_PATHS, {
    exclude: SD_FINGERPRINT_EXCLUDES,
  }),
  fingerprintPaths(roots.core, SD_COMPILED_FINGERPRINT_PATHS),
  fingerprintPaths(roots.webtools, SD_COMPILED_FINGERPRINT_PATHS),
  fingerprintPaths(roots.renderer, SD_RENDERER_FINGERPRINT_PATHS),
  hashFile(join(roots.core, 'dist/snapdragon_core.wasm')),
  hashFile(join(roots.webtools, 'dist/snapdragon_webtools.wasm')),
]);

const packageVersions = {
  sd: await requiredVersion(roots.sd, '@snapdragon-ai/sd'),
  core: await requiredVersion(roots.core, '@snapdragon-ai/core'),
  webtools: await requiredVersion(roots.webtools, '@snapdragon-ai/webtools'),
  renderer: await requiredVersion(roots.renderer, '@snapdragon-ai/ink'),
};

const buildInfo = {
  schemaVersion: 1,
  sourceHash: requiredHash('source', sourceHash),
  commit: await gitCommit(),
  artifactHashes: {
    runtime: requiredHash('runtime compiled artifacts', runtimeHash),
    sd: requiredHash('sd compiled artifacts', sdHash),
    core: requiredHash('core compiled artifacts', coreHash),
    webtools: requiredHash('webtools compiled artifacts', webtoolsHash),
    renderer: requiredHash('renderer compiled artifacts', rendererHash),
    coreWasm: requiredHash('core WASM', coreWasm),
    webtoolsWasm: requiredHash('webtools WASM', webtoolsWasm),
  },
  builtAt: new Date().toISOString(),
  packageVersions,
};

const output = join(roots.sd, 'dist/build-info.json');
await writeFile(output, `${JSON.stringify(buildInfo, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o644,
});
process.stdout.write(`wrote ${output}\n`);

async function gitCommit() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
  const commit = stdout.trim();
  if (!commit) throw new Error('Unable to resolve git commit for build info');
  return commit;
}

async function requiredVersion(root, name) {
  const version = await readNamedPackageVersion(root, name);
  if (!version) throw new Error(`Unable to resolve ${name} version from ${root}`);
  return version;
}

function requiredHash(label, hash) {
  if (!hash) throw new Error(`Unable to fingerprint ${label}`);
  return hash;
}
