import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { compileVerifiedWebtoolsArtifact, WebtoolsArtifactError } from '../src/wasm-artifact.js';

const root = resolve(import.meta.dirname, '../../..');
const dist = resolve(root, 'packages/webtools/dist');

test('packaged wasm matches cargo output and its build manifest fingerprints', async () => {
  const targetRoot = resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
  const cargoArtifact = await readFile(
    resolve(targetRoot, 'wasm32-unknown-unknown/release/snapdragon_webtools.wasm'),
  );
  const packagedArtifact = await readFile(resolve(dist, 'snapdragon_webtools.wasm'));
  assert.deepEqual(packagedArtifact, cargoArtifact);

  const manifest = JSON.parse(
    await readFile(resolve(dist, 'snapdragon_webtools.manifest.json'), 'utf8'),
  ) as BuildManifest;
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.artifact.bytes, packagedArtifact.byteLength);
  assert.equal(manifest.artifact.sha256, sha256(packagedArtifact));
  assert.equal(manifest.toolchain.target, 'wasm32-unknown-unknown');
  assert.equal(manifest.toolchain.cargo, commandOutput('cargo', ['--version']));
  assert.equal(manifest.toolchain.rustc, commandOutput('rustc', ['-vV']));
  assert.equal(
    manifest.toolchain.sha256,
    sha256(
      JSON.stringify({
        cargo: manifest.toolchain.cargo,
        rustc: manifest.toolchain.rustc,
        target: manifest.toolchain.target,
      }),
    ),
  );

  const sourceEntries = await Promise.all(
    manifest.source.files.map(async (entry) => ({
      ...entry,
      actual: sha256(await readFile(resolve(root, entry.path))),
    })),
  );
  for (const entry of sourceEntries) assert.equal(entry.sha256, entry.actual, entry.path);
  const sourceFingerprint = sourceEntries
    .map((entry) => `${entry.path}\0${entry.sha256}\n`)
    .join('');
  assert.equal(manifest.source.sha256, sha256(sourceFingerprint));
});

test('loader rejects a stale but valid wasm replacement before use', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'snapdragon-webtools-artifact-'));
  const artifactPath = resolve(directory, 'webtools.wasm');
  const manifestPath = resolve(directory, 'webtools.manifest.json');
  const expected = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const replacement = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 1, 0]);
  try {
    await WebAssembly.compile(replacement);
    await writeFile(artifactPath, replacement);
    await writeFile(manifestPath, JSON.stringify(manifestFor(expected)));
    await assert.rejects(
      compileVerifiedWebtoolsArtifact(pathToFileURL(artifactPath), pathToFileURL(manifestPath)),
      (error) => error instanceof WebtoolsArtifactError && error.failure === 'artifact_corrupt',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('loader reports typed errors for missing and corrupt packaged files', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'snapdragon-webtools-errors-'));
  const artifactPath = resolve(directory, 'webtools.wasm');
  const manifestPath = resolve(directory, 'webtools.manifest.json');
  const bytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const artifactUrl = pathToFileURL(artifactPath);
  const manifestUrl = pathToFileURL(manifestPath);
  try {
    await assertArtifactFailure(
      compileVerifiedWebtoolsArtifact(artifactUrl, manifestUrl),
      'manifest_missing',
    );
    await writeFile(manifestPath, '{}');
    await assertArtifactFailure(
      compileVerifiedWebtoolsArtifact(artifactUrl, manifestUrl),
      'manifest_corrupt',
    );
    await writeFile(manifestPath, JSON.stringify(manifestFor(bytes)));
    await assertArtifactFailure(
      compileVerifiedWebtoolsArtifact(artifactUrl, manifestUrl),
      'artifact_missing',
    );
    const invalidWasm = Uint8Array.from([0, 1, 2, 3]);
    await writeFile(artifactPath, invalidWasm);
    await writeFile(manifestPath, JSON.stringify(manifestFor(invalidWasm)));
    await assertArtifactFailure(
      compileVerifiedWebtoolsArtifact(artifactUrl, manifestUrl),
      'artifact_corrupt',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

interface BuildManifest {
  schemaVersion: number;
  source: { files: Array<{ path: string; sha256: string }>; sha256: string };
  toolchain: { cargo: string; rustc: string; target: string; sha256: string };
  artifact: { file: string; bytes: number; sha256: string };
}

function manifestFor(bytes: Uint8Array): BuildManifest {
  return {
    schemaVersion: 1,
    source: { files: [], sha256: sha256('') },
    toolchain: { cargo: '', rustc: '', target: 'wasm32-unknown-unknown', sha256: sha256('') },
    artifact: { file: 'webtools.wasm', bytes: bytes.byteLength, sha256: sha256(bytes) },
  };
}

async function assertArtifactFailure(
  promise: Promise<WebAssembly.Module>,
  failure: WebtoolsArtifactError['failure'],
): Promise<void> {
  await assert.rejects(
    promise,
    (error) => error instanceof WebtoolsArtifactError && error.failure === failure,
  );
}

function commandOutput(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
