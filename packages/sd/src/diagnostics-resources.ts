import type { SdDiagnosticsSample } from './diagnostics-types.js';

export function diagnosticsResourceCounts(resources: string[]): SdDiagnosticsSample['resources'] {
  const counts = {
    total: resources.length,
    fileSystem: 0,
    network: 0,
    timers: 0,
    processes: 0,
    signals: 0,
    terminal: 0,
    other: 0,
  };
  for (const resource of resources) counts[resourceBucket(resource)] += 1;
  return counts;
}

function resourceBucket(
  resource: string,
): Exclude<keyof SdDiagnosticsSample['resources'], 'total'> {
  if (/Timeout|Immediate/i.test(resource)) return 'timers';
  if (/FS|File|Stat|Dir|FSEvent/i.test(resource)) return 'fileSystem';
  if (/TCP|UDP|HTTP|TLS|Pipe|DNS|AddrInfo|Socket/i.test(resource)) return 'network';
  if (/Process|Child/i.test(resource)) return 'processes';
  if (/Signal/i.test(resource)) return 'signals';
  if (/TTY|Terminal/i.test(resource)) return 'terminal';
  return 'other';
}
