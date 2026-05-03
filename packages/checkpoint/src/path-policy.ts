import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'deno.json',
  '.snapdragon',
];

/**
 * Walk upward from `start` looking for a project-root marker.  Returns the
 * marker's directory, or `start` itself if nothing is found before we hit
 * the filesystem root.  Always returns an absolute, normalized path.
 */
export function getWorkingDirForPath(start: string): string {
  const abs = resolve(start);
  let current = isFileLike(abs) ? dirname(abs) : abs;
  let previous = '';
  while (current && current !== previous) {
    if (containsAnyMarker(current)) return current;
    previous = current;
    current = dirname(current);
  }
  return isFileLike(abs) ? dirname(abs) : abs;
}

function isFileLike(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    // Path may not exist yet (e.g. a write_file target).  Treat any path with
    // a final segment that contains '.' as file-like for the walk; otherwise
    // treat it as a directory candidate.
    return /\.[^/]+$/.test(path);
  }
}

function containsAnyMarker(dir: string): boolean {
  for (const marker of PROJECT_MARKERS) {
    if (existsSync(join(dir, marker))) return true;
  }
  return false;
}

/**
 * Reject obviously-bogus or path-traversing relative file specs.  Returns
 * the relative path from `workTree` to `target`, or `undefined` when the
 * target escapes the work tree.
 */
export function relativeWithinWorkTree(workTree: string, target: string): string | undefined {
  const absTarget = isAbsolute(target) ? target : resolve(workTree, target);
  const rel = relative(resolve(workTree), normalize(absTarget));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel;
}

/**
 * Validate a git commit hash.  Accept full 40-char hex or unambiguous
 * abbreviations down to 4 chars.
 */
export function isValidCommitHash(value: string): boolean {
  return /^[0-9a-f]{4,40}$/i.test(value);
}
