import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'mutants.out',
  'mutants.out.old',
]);

export async function discoverFiles(root, predicate) {
  const out = [];
  await visit(root, out, predicate);
  return out.sort();
}

async function visit(dir, out, predicate) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await visit(full, out, predicate);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
}
