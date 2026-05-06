import { spawn } from 'node:child_process';
import { mkdir, symlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { GatewayProjectRef } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';

export interface SandboxLeaseOptions {
  projectRoot: string;
  backend: string;
  id?: string;
  ttlMs?: number;
  referenceRoots: string[];
}

export function parseLeaseArgs(rest: string[], args: SdCliArgs): SandboxLeaseOptions {
  const options: SandboxLeaseOptions = {
    projectRoot: resolve(args.cwd ?? process.cwd()),
    backend: 'worktree',
    referenceRoots: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    index = applyLeaseArg(options, rest, index);
  }
  return options;
}

function applyLeaseArg(options: SandboxLeaseOptions, rest: string[], index: number): number {
  const value = rest[index];
  if (value === '--backend') return readBackend(options, rest, index);
  if (value === '--id') return readId(options, rest, index);
  if (value === '--ttl-ms') return readTtl(options, rest, index);
  if (value === '--ref') return readReferenceRoot(options, rest, index);
  options.projectRoot = resolve(value);
  return index;
}

function readBackend(options: SandboxLeaseOptions, rest: string[], index: number): number {
  options.backend = rest[index + 1] ?? 'worktree';
  return index + 1;
}

function readId(options: SandboxLeaseOptions, rest: string[], index: number): number {
  options.id = safeName(rest[index + 1] ?? '');
  return index + 1;
}

function readTtl(options: SandboxLeaseOptions, rest: string[], index: number): number {
  options.ttlMs = Number(rest[index + 1] ?? 0) || undefined;
  return index + 1;
}

function readReferenceRoot(options: SandboxLeaseOptions, rest: string[], index: number): number {
  options.referenceRoots.push(resolve(rest[index + 1] ?? '.'));
  return index + 1;
}

export async function projectRef(root: string): Promise<GatewayProjectRef> {
  const repoRoot = await runGitOutput(['-C', root, 'rev-parse', '--show-toplevel']);
  const branch = await runGitOutput(['-C', repoRoot, 'branch', '--show-current']).catch(() => '');
  return {
    id: safeName(basename(repoRoot)),
    root: repoRoot,
    branch: branch || undefined,
  };
}

export async function linkReferenceRoots(cwd: string, roots: string[]): Promise<void> {
  if (roots.length === 0) return;
  const refDir = join(cwd, '.snapdragon', 'references');
  await mkdir(refDir, { recursive: true });
  for (const root of roots) {
    await symlink(root, join(refDir, safeName(basename(root))));
  }
}

export function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_') || 'sandbox';
}

export function runGit(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`git ${args.join(' ')} exited ${code}`));
    });
  });
}

function runGitOutput(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString('utf8').trim());
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim()));
    });
  });
}
