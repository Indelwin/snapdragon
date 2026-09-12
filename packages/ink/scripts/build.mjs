import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const archive = `${root}vendor/ink-7.0.1.tgz`;
const expected =
  'o6LAC268PLawlGVYrXTyaTfke4VtJftEheuwbgkQf7yvSXyWp1nRwBbAyKEkWXFZZsW/la5wrMuNbuBvZK2C1w==';
const actual = createHash('sha512').update(readFileSync(archive)).digest('base64');
if (actual !== expected) throw new Error('Ink upstream archive integrity mismatch');
mkdirSync(`${root}dist`, { recursive: true });
execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', `${root}dist`]);
rmSync(`${root}dist/package.json`);
for (const file of ['text-cache.js', 'measure-text.js', 'wrap-text.js']) {
  copyFileSync(`${root}src/${file}`, `${root}dist/build/${file}`);
}
