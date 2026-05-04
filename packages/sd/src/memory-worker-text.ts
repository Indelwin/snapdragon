import { existsSync, readFileSync } from 'node:fs';

export function collectExistingHashes(memoryPath: string): Set<string> {
  const hashes = new Set<string>();
  if (!existsSync(memoryPath)) return hashes;
  for (const section of readFileSync(memoryPath, 'utf8').split(/\n(?=##\s+)/g)) {
    addSectionHash(hashes, section);
  }
  return hashes;
}

export function hashContent(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function truncateForTitle(value: string, max = 60): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 1).trimEnd()}…`;
}

function addSectionHash(hashes: Set<string>, section: string): void {
  if (!section.startsWith('## ')) return;
  const body = section.split(/\n\n/).slice(1).join('\n\n').trim();
  if (body) hashes.add(hashContent(body));
}
