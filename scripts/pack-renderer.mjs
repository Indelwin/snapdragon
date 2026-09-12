import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fingerprintPaths,
  SD_RENDERER_FINGERPRINT_PATHS,
} from '../packages/sd/dist/doctor-build.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'packages/sd/node_modules');
const marker = join(modules, '.renderer-pack');
const buildInfoPath = join(root, 'packages/sd/dist/build-info.json');
const packages = ['ink'];
const hostDependencies = new Set(['react']);
if (process.argv.includes('--clean')) {
  if (existsSync(marker)) {
    const state = JSON.parse(readFileSync(marker, 'utf8'));
    writeFileSync(buildInfoPath, state.buildInfo);
    for (const name of packages) rmSync(join(modules, name), { recursive: true, force: true });
    rmSync(marker);
  }
} else {
  if (existsSync(marker))
    throw new Error('Renderer packaging is already staged; finish or clean that pack first');
  if (packages.some((name) => existsSync(join(modules, name)))) {
    throw new Error('Refusing to replace existing sd renderer dependencies');
  }
  mkdirSync(modules, { recursive: true });
  writeFileSync(marker, JSON.stringify({ buildInfo: readFileSync(buildInfoPath, 'utf8') }), {
    flag: 'wx',
  });
  try {
    for (const name of packages) materialize(name);
    const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
    const rendererHash = await fingerprintPaths(
      join(modules, 'ink'),
      SD_RENDERER_FINGERPRINT_PATHS,
    );
    if (!rendererHash) throw new Error('Unable to fingerprint staged renderer');
    buildInfo.artifactHashes.renderer = rendererHash;
    writeFileSync(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`);
  } catch (error) {
    const state = JSON.parse(readFileSync(marker, 'utf8'));
    writeFileSync(buildInfoPath, state.buildInfo);
    for (const name of packages) rmSync(join(modules, name), { recursive: true, force: true });
    rmSync(marker);
    throw error;
  }
}

function materialize(name) {
  const source = name === 'ink' ? join(root, 'packages/ink') : join(root, 'node_modules', name);
  const target = join(modules, name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  for (const file of manifest.files) {
    const path = join(source, file);
    if (existsSync(path)) cpSync(path, join(target, file), { recursive: true });
  }
  writeStagedManifest(target, manifest);
  stageDependencies(source, target, new Set([realpathSync(source)]));
}

// npm does not traverse transitive dependencies of workspace links when bundling.
// Materialize the published dependency tree, never peers (notably React).
function stageDependencies(source, target, ancestors) {
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const optional = manifest.optionalDependencies ?? {};
  for (const name of Object.keys({ ...manifest.dependencies, ...optional })) {
    const dependency = resolveDependency(source, name);
    if (!dependency && name in optional) continue;
    if (!dependency) throw new Error(`Missing renderer runtime dependency: ${name}`);
    if (ancestors.has(dependency)) continue;
    const destination = join(target, 'node_modules', name);
    cpSync(dependency, destination, {
      recursive: true,
      filter: (path) =>
        path === dependency ||
        !path
          .slice(dependency.length + 1)
          .split('/')
          .includes('node_modules'),
    });
    const dependencyManifest = JSON.parse(readFileSync(join(dependency, 'package.json'), 'utf8'));
    writeStagedManifest(destination, dependencyManifest);
    stageDependencies(dependency, destination, new Set([...ancestors, dependency]));
  }
}

// npm can mistake peers of bundled packages for bundled files and prune the
// host's real package. The staged renderer resolves these from sd instead.
function writeStagedManifest(target, manifest) {
  const staged = structuredClone(manifest);
  for (const name of hostDependencies) {
    delete staged.peerDependencies?.[name];
    delete staged.peerDependenciesMeta?.[name];
  }
  if (staged.peerDependencies && Object.keys(staged.peerDependencies).length === 0) {
    delete staged.peerDependencies;
  }
  if (staged.peerDependenciesMeta && Object.keys(staged.peerDependenciesMeta).length === 0) {
    delete staged.peerDependenciesMeta;
  }
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(staged, null, 2)}\n`);
}

function resolveDependency(source, name) {
  let current = source;
  while (true) {
    const candidate = join(current, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
