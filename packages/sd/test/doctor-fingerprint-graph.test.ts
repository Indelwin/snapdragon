import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import type { SdBuildInfo } from '../src/build-info.ts';
import { collectSdDoctorReport } from '../src/doctor.ts';
import {
  fingerprintPaths,
  hashFile,
  SD_FINGERPRINT_EXCLUDES,
  SD_RENDERER_FINGERPRINT_PATHS,
} from '../src/doctor-build.ts';
import { fingerprintSdRuntimeArtifacts } from '../src/doctor-runtime-fingerprint.ts';

test('runtime fingerprint follows global transitive packages and the ink alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapdragon-global-runtime-'));
  const modules = join(root, 'lib/node_modules');
  const sd = join(modules, '@snapdragon-ai/sd');
  const agent = join(modules, '@snapdragon-ai/agent');
  const core = join(modules, '@snapdragon-ai/core');
  const webtools = join(modules, '@snapdragon-ai/webtools');
  const renderer = join(modules, 'ink');
  try {
    await installedPackage(sd, '@snapdragon-ai/sd', {
      '@snapdragon-ai/agent': '0.1.1',
      ink: 'file:../../ink',
    });
    await installedPackage(agent, '@snapdragon-ai/agent', {
      '@snapdragon-ai/core': '0.1.1',
    });
    await installedPackage(core, '@snapdragon-ai/core');
    await installedPackage(webtools, '@snapdragon-ai/webtools');
    await installedPackage(renderer, '@snapdragon-ai/ink', {}, 'dist/build/index.js');
    await write(core, 'dist/snapdragon_core.wasm', 'core wasm');
    await write(webtools, 'dist/snapdragon_webtools.wasm', 'webtools wasm');

    const runtime = required(await fingerprintSdRuntimeArtifacts(sd));
    await write(
      sd,
      'dist/build-info.json',
      JSON.stringify(await globalBuildInfo({ runtime, sd, core, webtools, renderer })),
    );
    const report = await collectSdDoctorReport({
      sdPackageRoot: sd,
      packageRoots: { core, webtools, renderer },
      cliEntrypoint: null,
      rendererMode: 'production',
    });
    assert.equal(report.compiled.runtime.matchesBuild, true);
    assert.equal(
      report.warnings.some((warning) => warning.target === 'runtime'),
      false,
    );

    await write(core, 'dist/index.js', 'changed transitive core');
    const transitiveChange = required(await fingerprintSdRuntimeArtifacts(sd));
    assert.notEqual(transitiveChange, runtime);
    await write(renderer, 'dist/build/index.js', 'changed renderer');
    assert.notEqual(await fingerprintSdRuntimeArtifacts(sd), transitiveChange);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

interface GlobalPackageRoots {
  runtime: string;
  sd: string;
  core: string;
  webtools: string;
  renderer: string;
}

async function globalBuildInfo(roots: GlobalPackageRoots): Promise<SdBuildInfo> {
  const [sd, core, webtools, renderer, coreWasm, webtoolsWasm] = await Promise.all([
    fingerprintPaths(roots.sd, ['dist'], { exclude: SD_FINGERPRINT_EXCLUDES }),
    fingerprintPaths(roots.core, ['dist']),
    fingerprintPaths(roots.webtools, ['dist']),
    fingerprintPaths(roots.renderer, SD_RENDERER_FINGERPRINT_PATHS),
    hashFile(join(roots.core, 'dist/snapdragon_core.wasm')),
    hashFile(join(roots.webtools, 'dist/snapdragon_webtools.wasm')),
  ]);
  return {
    schemaVersion: 1,
    sourceHash: 'a'.repeat(64),
    commit: 'global-install-fixture',
    artifactHashes: {
      runtime: roots.runtime,
      sd: required(sd),
      core: required(core),
      webtools: required(webtools),
      renderer: required(renderer),
      coreWasm: required(coreWasm),
      webtoolsWasm: required(webtoolsWasm),
    },
    builtAt: '2026-09-12T00:00:00.000Z',
    packageVersions: { sd: '0.1.1', core: '0.1.1', webtools: '0.1.1', renderer: '0.1.1' },
  };
}

async function installedPackage(
  root: string,
  name: string,
  dependencies: Record<string, string> = {},
  artifact = 'dist/index.js',
): Promise<void> {
  await write(root, 'package.json', JSON.stringify({ name, version: '0.1.1', dependencies }));
  await write(root, artifact, `${name} compiled`);
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
