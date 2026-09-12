import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function git(args, options = {}) {
  const { stdout } = await exec('git', args, {
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    cwd: options.cwd,
    env: options.env,
  });
  return stdout.trimEnd();
}

export async function gitMaybe(args, options) {
  try {
    return await git(args, options);
  } catch {
    return undefined;
  }
}

export async function resolveBaseRef() {
  const candidates = [
    process.env.QUALITY_BASE_REF,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
    'origin/main',
    'main',
  ].filter(Boolean);
  for (const ref of candidates) {
    const base = await gitMaybe(['merge-base', 'HEAD', ref]);
    if (base) return base;
  }
  return gitMaybe(['rev-parse', 'HEAD~1']);
}

export async function changedFiles(baseRef, options) {
  if (!baseRef) return [];
  const tracked = await git(
    ['diff', '--name-only', '--diff-filter=ACMRT', '-z', baseRef, '--'],
    options,
  );
  const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z'], options);
  return [...new Set(`${tracked}\0${untracked}`.split('\0').filter(Boolean))];
}

export async function showFile(ref, file) {
  return gitMaybe(['show', `${ref}:${file}`]);
}
