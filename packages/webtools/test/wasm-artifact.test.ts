import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

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

interface BuildManifest {
  schemaVersion: number;
  source: { files: Array<{ path: string; sha256: string }>; sha256: string };
  toolchain: { cargo: string; rustc: string; target: string; sha256: string };
  artifact: { file: string; bytes: number; sha256: string };
}

function commandOutput(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
