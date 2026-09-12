import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { SdBuildInfo } from '../src/build-info.ts';
import { collectSdDoctorReport } from '../src/doctor.ts';
import {
  fingerprintPaths,
  hashFile,
  SD_COMPILED_FINGERPRINT_PATHS,
  SD_FINGERPRINT_EXCLUDES,
  SD_RENDERER_FINGERPRINT_PATHS,
} from '../src/doctor-build.ts';
import { resolveDoctorPackageRoot } from '../src/doctor-package-root.ts';
import { fingerprintSdRuntimeArtifacts } from '../src/doctor-runtime-fingerprint.ts';
import {
  discoverSdSourceFingerprintPaths,
  fingerprintSdSource,
} from '../src/doctor-source-fingerprint.ts';

const execFileAsync = promisify(execFile);

test('doctor reports fixed build, package, renderer, and WASM fields', async () => {
  const fixture = await doctorFixture();
  try {
    const report = await collectSdDoctorReport(fixture.options);
    assert.deepEqual(Object.keys(report), [
      'schemaVersion',
      'paths',
      'versions',
      'build',
      'source',
      'compiled',
      'wasm',
      'warnings',
    ]);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.versions.renderer, '7.0.2');
    assert.equal(
      report.paths.rendererPackage,
      join(await realpath(fixture.rendererRoot), 'package.json'),
    );
    assert.equal(report.build.commit, '0123456789abcdef0123456789abcdef01234567');
    assert.equal(report.compiled.sd.matchesBuild, true);
    assert.equal(report.compiled.renderer.matchesBuild, true);
    assert.equal(report.wasm.core.matchesBuild, true);
    assert.equal(report.wasm.webtools.matchesBuild, true);
    assert.deepEqual(report.warnings, []);
    assert.doesNotMatch(JSON.stringify(report), /DO_NOT_REPORT|api[_-]?key/i);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('doctor warns when compiled and WASM artifacts do not match the manifest', async () => {
  const fixture = await doctorFixture();
  try {
    await writeFile(join(fixture.coreRoot, 'dist/snapdragon_core.wasm'), 'different wasm');
    const report = await collectSdDoctorReport(fixture.options);
    assert.equal(report.compiled.core.matchesBuild, false);
    assert.equal(report.wasm.core.matchesBuild, false);
    assert.ok(
      report.warnings.some(
        (warning) => warning.code === 'compiled_hash_mismatch' && warning.target === 'core',
      ),
    );
    assert.ok(
      report.warnings.some(
        (warning) => warning.code === 'artifact_hash_mismatch' && warning.target === 'core',
      ),
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('doctor reports effective development rendering without exposing NODE_ENV', async () => {
  const fixture = await doctorFixture();
  try {
    const report = await collectSdDoctorReport({ ...fixture.options, rendererMode: 'development' });
    assert.equal(report.versions.rendererMode, 'development');
    assert.ok(report.warnings.some((warning) => warning.code === 'renderer_development_mode'));
    assert.equal('nodeEnv' in report.versions, false);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('fingerprints are independent of their absolute root and exclude build-info', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapdragon-fingerprint-'));
  try {
    const left = join(root, 'left');
    const right = join(root, 'right');
    for (const packageRoot of [left, right]) {
      await write(packageRoot, 'dist/index.js', 'same compiled bytes');
      await write(packageRoot, 'dist/build-info.json', packageRoot);
    }
    const leftHash = await fingerprintPaths(left, ['dist'], { exclude: SD_FINGERPRINT_EXCLUDES });
    const rightHash = await fingerprintPaths(right, ['dist'], { exclude: SD_FINGERPRINT_EXCLUDES });
    assert.equal(leftHash, rightHash);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('source fingerprint follows the transitive sd workspace graph', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapdragon-source-graph-'));
  try {
    await sourceGraphFixture(root);
    const paths = await discoverSdSourceFingerprintPaths(root);
    assert.ok(paths);
    for (const packageName of ['sd', 'agent', 'host', 'ui', 'ink']) {
      assert.ok(paths.includes(`packages/${packageName}/src`), packageName);
    }
    assert.equal(paths.includes('packages/unrelated/src'), false);

    const baseline = required(await fingerprintSdSource(root));
    await write(root, 'packages/unrelated/src/index.ts', 'export const unrelated = 2;');
    assert.equal(await fingerprintSdSource(root), baseline);
    await write(root, 'packages/agent/src/index.ts', 'export const agent = 2;');
    assert.notEqual(await fingerprintSdSource(root), baseline);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('runtime fingerprint includes installed Snapdragon dependency artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapdragon-runtime-graph-'));
  const sdRoot = join(root, 'sd');
  const agentRoot = join(root, 'agent');
  try {
    await packageFiles(agentRoot, '@snapdragon-ai/agent', '0.1.1', 'agent compiled');
    await packageFiles(sdRoot, '@snapdragon-ai/sd', '0.1.1', 'sd compiled');
    await write(
      sdRoot,
      'package.json',
      JSON.stringify({
        name: '@snapdragon-ai/sd',
        version: '0.1.1',
        main: './dist/index.js',
        dependencies: { '@snapdragon-ai/agent': '0.1.1' },
      }),
    );
    const dependencyPath = join(sdRoot, 'node_modules/@snapdragon-ai/agent');
    await mkdir(dirname(dependencyPath), { recursive: true });
    await symlink(agentRoot, dependencyPath, 'dir');

    const baseline = required(await fingerprintSdRuntimeArtifacts(sdRoot));
    await write(agentRoot, 'dist/index.js', 'changed agent compiled');
    assert.notEqual(await fingerprintSdRuntimeArtifacts(sdRoot), baseline);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('renderer resolution skips an upstream manifest nested under the fork dist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapdragon-renderer-resolution-'));
  const sdRoot = join(root, 'sd');
  const rendererRoot = join(sdRoot, 'node_modules/ink');
  try {
    await write(sdRoot, 'package.json', JSON.stringify({ name: '@snapdragon-ai/sd' }));
    await write(
      rendererRoot,
      'package.json',
      JSON.stringify({
        name: '@snapdragon-ai/ink',
        version: '7.0.2',
        main: './dist/build/index.js',
      }),
    );
    await write(
      rendererRoot,
      'dist/package.json',
      JSON.stringify({ name: 'ink', version: '7.0.1' }),
    );
    await write(rendererRoot, 'dist/build/index.js', 'export const renderer = true;');

    const resolved = await resolveDoctorPackageRoot(
      sdRoot,
      'ink',
      '@snapdragon-ai/ink',
      undefined,
      'ink',
    );
    assert.equal(resolved, await realpath(rendererRoot));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('sd doctor --json does not load provider or TUI modules', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'snapdragon-doctor-loader-'));
  try {
    const loaderPath = join(fixture, 'loader.mjs');
    const registerPath = join(fixture, 'register.mjs');
    await writeFile(
      loaderPath,
      `export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  const path = result.url.replaceAll('\\\\', '/');
  if (/\\/packages\\/sd\\/src\\/provider\\.ts$/.test(path) ||
      /\\/packages\\/sd\\/src\\/tui\\//.test(path) ||
      /\\/packages\\/host\\/src\\/providers\\//.test(path)) {
    throw new Error('forbidden doctor side effect: ' + path);
  }
  return result;
}
`,
      'utf8',
    );
    await writeFile(
      registerPath,
      `import { register } from 'node:module';
register(${JSON.stringify(loaderPath)}, import.meta.url);
`,
      'utf8',
    );
    const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import=tsx', `--import=${registerPath}`, cliPath, 'doctor', '--json'],
      {
        cwd: dirname(cliPath),
        env: { ...process.env, SD_DOCTOR_TEST_SECRET: 'DO_NOT_REPORT' },
      },
    );
    const report = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(report.schemaVersion, 1);
    assert.doesNotMatch(stdout, /DO_NOT_REPORT/);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
});

interface DoctorFixture {
  root: string;
  sdRoot: string;
  coreRoot: string;
  webtoolsRoot: string;
  rendererRoot: string;
  options: Parameters<typeof collectSdDoctorReport>[0];
}

async function doctorFixture(): Promise<DoctorFixture> {
  const root = await mkdtemp(join(tmpdir(), 'snapdragon-doctor-'));
  const sdRoot = join(root, 'packages/sd');
  const coreRoot = join(root, 'packages/core');
  const webtoolsRoot = join(root, 'packages/webtools');
  const rendererRoot = join(root, 'packages/ink');
  await write(root, 'package.json', JSON.stringify({ name: 'snapdragon-monorepo' }));
  await packageFiles(sdRoot, '@snapdragon-ai/sd', '0.1.1', 'sd compiled');
  await packageFiles(coreRoot, '@snapdragon-ai/core', '0.1.1', 'core compiled');
  await packageFiles(webtoolsRoot, '@snapdragon-ai/webtools', '0.1.0', 'webtools compiled');
  await packageFiles(rendererRoot, '@snapdragon-ai/ink', '7.0.2', 'renderer compiled');
  await write(rendererRoot, 'dist/package.json', JSON.stringify({ name: 'ink', version: '7.0.1' }));
  await write(coreRoot, 'dist/snapdragon_core.wasm', 'core wasm');
  await write(webtoolsRoot, 'dist/snapdragon_webtools.wasm', 'webtools wasm');
  await write(
    sdRoot,
    'dist/build-info.json',
    JSON.stringify(
      await buildInfo({
        sdRoot,
        coreRoot,
        webtoolsRoot,
        rendererRoot,
      }),
    ),
  );
  return {
    root,
    sdRoot,
    coreRoot,
    webtoolsRoot,
    rendererRoot,
    options: {
      sdPackageRoot: sdRoot,
      packageRoots: { core: coreRoot, webtools: webtoolsRoot, renderer: rendererRoot },
      cliEntrypoint: join(sdRoot, 'dist/index.js'),
      nodeExecutable: process.execPath,
      nodeVersion: '22.test',
      rendererMode: 'production',
    },
  };
}

async function buildInfo(roots: Omit<DoctorFixture, 'root' | 'options'>): Promise<SdBuildInfo> {
  const [runtime, sd, core, webtools, renderer, coreWasm, webtoolsWasm] = await Promise.all([
    fingerprintSdRuntimeArtifacts(roots.sdRoot),
    fingerprintPaths(roots.sdRoot, SD_COMPILED_FINGERPRINT_PATHS, {
      exclude: SD_FINGERPRINT_EXCLUDES,
    }),
    fingerprintPaths(roots.coreRoot, SD_COMPILED_FINGERPRINT_PATHS),
    fingerprintPaths(roots.webtoolsRoot, SD_COMPILED_FINGERPRINT_PATHS),
    fingerprintPaths(roots.rendererRoot, SD_RENDERER_FINGERPRINT_PATHS),
    hashFile(join(roots.coreRoot, 'dist/snapdragon_core.wasm')),
    hashFile(join(roots.webtoolsRoot, 'dist/snapdragon_webtools.wasm')),
  ]);
  return {
    schemaVersion: 1,
    sourceHash: createHash('sha256').update('source').digest('hex'),
    commit: '0123456789abcdef0123456789abcdef01234567',
    artifactHashes: {
      runtime: required(runtime),
      sd: required(sd),
      core: required(core),
      webtools: required(webtools),
      renderer: required(renderer),
      coreWasm: required(coreWasm),
      webtoolsWasm: required(webtoolsWasm),
    },
    builtAt: '2026-09-12T00:00:00.000Z',
    packageVersions: { sd: '0.1.1', core: '0.1.1', webtools: '0.1.0', renderer: '7.0.2' },
  };
}

async function packageFiles(root: string, name: string, version: string, compiled: string) {
  await write(root, 'package.json', JSON.stringify({ name, version, main: './dist/index.js' }));
  await write(root, 'dist/index.js', compiled);
  if (name === '@snapdragon-ai/ink') await write(root, 'dist/build/index.js', compiled);
}

async function sourceGraphFixture(root: string): Promise<void> {
  await write(
    root,
    'package.json',
    JSON.stringify({ name: 'snapdragon-monorepo', workspaces: ['packages/*'] }),
  );
  for (const path of [
    'Cargo.lock',
    'Cargo.toml',
    'package-lock.json',
    'tsconfig.base.json',
    'scripts/build-info.mjs',
    'scripts/build-wasm.sh',
    'scripts/build-webtools-wasm.sh',
    'crates/core/Cargo.toml',
    'crates/core/src/lib.rs',
    'crates/webtools/Cargo.toml',
    'crates/webtools/src/lib.rs',
  ]) {
    await write(root, path, path);
  }
  await sourcePackage(root, 'sd', '@snapdragon-ai/sd', {
    '@snapdragon-ai/agent': '0.1.1',
    '@snapdragon-ai/ui': '0.1.1',
    ink: 'file:../ink',
  });
  await sourcePackage(root, 'agent', '@snapdragon-ai/agent', {
    '@snapdragon-ai/host': '0.1.1',
  });
  await sourcePackage(root, 'host', '@snapdragon-ai/host');
  await sourcePackage(root, 'ui', '@snapdragon-ai/ui');
  await sourcePackage(root, 'ink', '@snapdragon-ai/ink');
  await sourcePackage(root, 'unrelated', '@snapdragon-ai/unrelated');
}

async function sourcePackage(
  root: string,
  directory: string,
  name: string,
  dependencies: Record<string, string> = {},
): Promise<void> {
  await write(root, `packages/${directory}/package.json`, JSON.stringify({ name, dependencies }));
  await write(root, `packages/${directory}/src/index.ts`, `export const ${directory} = 1;`);
  await write(root, `packages/${directory}/tsconfig.build.json`, '{}');
}

async function write(root: string, path: string, content: string): Promise<void> {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

function required(value: string | null): string {
  assert.ok(value);
  return value;
}
