import type { WebtoolsCore } from './wasm-types.js';

const MAX_TRACKED_CORES = 256;

interface RegistryEntry {
  id: number;
  core: WeakRef<WebtoolsCore>;
}

export interface WebtoolsWasmMemoryStats {
  activeCores: number;
  memoryPages: number;
  maxCoreMemoryPages: number;
  registryEntries: number;
  droppedRegistrations: number;
}

let nextId = 1;
let droppedRegistrations = 0;
let entries: RegistryEntry[] = [];

export function getWebtoolsWasmMemoryStats(): Readonly<WebtoolsWasmMemoryStats> {
  const liveEntries = collectLiveEntries();
  let memoryPages = 0;
  let maxCoreMemoryPages = 0;

  for (const entry of liveEntries) {
    const diagnostics = entry.core.deref()?.diagnostics();
    memoryPages += diagnostics?.memoryPages ?? 0;
    maxCoreMemoryPages = Math.max(maxCoreMemoryPages, diagnostics?.maxMemoryPages ?? 0);
  }

  return Object.freeze({
    activeCores: liveEntries.length,
    memoryPages,
    maxCoreMemoryPages,
    registryEntries: entries.length,
    droppedRegistrations,
  });
}

export function registerWebtoolsCore(core: WebtoolsCore): () => void {
  collectLiveEntries();
  if (entries.length >= MAX_TRACKED_CORES) {
    droppedRegistrations += 1;
    return () => undefined;
  }

  const id = nextId;
  nextId += 1;
  entries.push({ id, core: new WeakRef(core) });
  return () => {
    entries = entries.filter((entry) => entry.id !== id);
  };
}

function collectLiveEntries(): RegistryEntry[] {
  entries = entries.filter((entry) => entry.core.deref() !== undefined);
  return entries;
}
