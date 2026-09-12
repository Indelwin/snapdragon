import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const temp = await mkdtemp(join(tmpdir(), 'sd-packed-reliability-'));
const artifacts = join(temp, 'artifacts');
const globalInstall = process.env.SD_PACK_GLOBAL === '1';
const install = join(temp, globalInstall ? 'global/lib' : 'install');
await mkdir(artifacts);
await mkdir(install, { recursive: true });
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const forkedRenderer = manifest.workspaces.includes('packages/ink');
const dependencies = {};
try {
  for (const workspace of manifest.workspaces.filter((path) => path.startsWith('packages/'))) {
    const pkg = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'));
    if (pkg.private || pkg.name === '@snapdragon-ai/ink') continue;
    const result = execFileSync(
      'npm',
      ['pack', '--workspace', pkg.name, '--pack-destination', artifacts, '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const packed = JSON.parse(result);
    dependencies[pkg.name] = `file:${join(artifacts, packed[0].filename)}`;
  }
  await writeFile(
    join(install, 'package.json'),
    JSON.stringify({ private: true, type: 'module', dependencies }),
  );
  const installArgs = globalInstall
    ? [
        'install',
        '--global',
        '--prefix',
        join(temp, 'global'),
        ...Object.values(dependencies).map((path) => path.slice(5)),
      ]
    : ['install'];
  execFileSync('npm', [...installArgs, '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: install,
    stdio: 'inherit',
  });
  const installed = await readdir(join(install, 'node_modules'), { recursive: true });
  for (const name of forkedRenderer ? ['ink', 'react'] : []) {
    const paths = installed.filter(
      (path) => path === name || path.endsWith(`/node_modules/${name}`),
    );
    const copies = new Set();
    for (const path of paths) {
      const resolved = await realpath(join(install, 'node_modules', path));
      assert(
        resolved.startsWith(`${await realpath(temp)}/`),
        `Dependency escaped fresh install: ${resolved}`,
      );
      copies.add(resolved);
    }
    assert.equal(copies.size, 1, `Expected one installed ${name}, found ${[...copies].join(', ')}`);
  }
  const env = { ...process.env, HOME: join(temp, 'home'), NODE_ENV: 'production' };
  const sd = globalInstall ? join(temp, 'global/bin/sd') : join(install, 'node_modules/.bin/sd');
  for (const args of [
    ['--help'],
    ['--version'],
    ...(forkedRenderer ? [['doctor', '--json']] : []),
    ['--provider', 'mock', '--no-session', '--no-background', '--no-profile', 'packed smoke'],
  ]) {
    const output = execFileSync(process.execPath, [sd, ...args], {
      cwd: install,
      env,
      encoding: 'utf8',
    });
    assert(output.trim().length > 0, `Empty CLI output for ${args[0]}`);
    if (args[0] === 'doctor') {
      const report = JSON.parse(output);
      assert.equal(report.versions.renderer, '7.0.2');
      assert.equal(report.versions.rendererMode, 'production');
      assert.equal(report.build.manifestStatus, 'ok');
      assert.equal(report.source.root, null);
      assert.deepEqual(report.warnings, []);
      for (const artifact of Object.values({ ...report.compiled, ...report.wasm })) {
        assert.equal(artifact.matchesBuild, true);
        assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
      }
    }
    console.log(`Packed CLI: ${args[0]} passed`);
  }
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { readFileSync } from 'node:fs';
    import { dirname, join } from 'node:path';
    import { PassThrough, Writable } from 'node:stream';
    import { extractor } from '@snapdragon-ai/webtools';
    const require = createRequire(import.meta.url);
    const sd = import.meta.resolve('@snapdragon-ai/sd');
    const sdRequire = createRequire(sd);
    const ink = sdRequire.resolve('ink');
    if (${forkedRenderer}) {
      const pkg = JSON.parse(readFileSync(join(dirname(ink), '../../package.json'), 'utf8'));
      assert.equal(pkg.name, '@snapdragon-ai/ink');
    }
    const reactPath = sdRequire.resolve('react');
    assert.equal(createRequire(ink).resolve('react'), reactPath, 'Renderer and sd disagree on React');
    if (${forkedRenderer && !globalInstall}) assert.equal(reactPath, require.resolve('react'), 'sd loaded a second React');
    const { createElement } = await import(reactPath);
    const { render, Text } = await import(ink);
    await import('@snapdragon-ai/sd/tui');
    const stdin = new PassThrough();
    const stdout = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const rendered = render(createElement(Text, {}, 'Packed renderer proof'), { stdin, stdout, stderr: stdout, patchConsole: false });
    await rendered.waitUntilRenderFlush();
    const exited = rendered.waitUntilExit();
    rendered.unmount();
    await exited;
    stdin.destroy(); stdout.destroy();
    const extraction = await extractor();
    try {
      const parsed = extraction.extract('<html><body><h1>Pack proof</h1><p>Local WASM extraction.</p></body></html>');
      assert(parsed.markdown.includes('Pack proof'));
    } finally {
      extraction.dispose?.();
    }
    console.log('Installed renderer mount and packaged WASM extraction passed');
  `,
    ],
    { cwd: install, env, stdio: 'inherit' },
  );
  console.log(
    `Fresh packed ${globalInstall ? 'global' : 'local'} installation passed without install scripts.`,
  );
} finally {
  if (process.env.SD_PACK_KEEP === '1') console.log(`Retained synthetic packed fixture: ${temp}`);
  else await rm(temp, { recursive: true, force: true });
}
