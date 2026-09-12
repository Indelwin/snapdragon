import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExtensionDescriptor } from '@snapdragon-ai/content';
import type { SdExtensionModule } from './extension-runtime-types.js';

export async function importExtensionModule(
  descriptor: ExtensionDescriptor,
): Promise<SdExtensionModule> {
  return (await import(pathToFileURL(requiredMainPath(descriptor)).href)) as SdExtensionModule;
}

export function resolveExtensionPath(descriptor: ExtensionDescriptor, path: string): string {
  if (!descriptor.dir) throw new Error(`Extension ${descriptor.id} has no directory.`);
  const root = resolve(descriptor.dir);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error(`Extension path escapes root: ${path}`);
  }
  return target;
}

function requiredMainPath(descriptor: ExtensionDescriptor): string {
  if (!descriptor.main) throw new Error(`Extension ${descriptor.id} does not declare main.`);
  const path = resolveExtensionPath(descriptor, descriptor.main);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Extension ${descriptor.id} main not found: ${descriptor.main}`);
  }
  return path;
}
