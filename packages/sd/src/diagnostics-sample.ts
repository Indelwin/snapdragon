import { diagnosticsResourceCounts } from './diagnostics-resources.js';
import {
  SD_DIAGNOSTICS_SCHEMA_VERSION,
  type SdDiagnosticsOptions,
  type SdDiagnosticsPhase,
  type SdDiagnosticsSample,
} from './diagnostics-types.js';
import { diagnosticsWasmPages } from './diagnostics-wasm.js';

const PHASES = new Set<SdDiagnosticsPhase>([
  'startup',
  'idle',
  'running',
  'provider',
  'tool',
  'shutdown',
  'unknown',
]);

export interface SdDiagnosticsSampleContext {
  phase: unknown;
  now: () => number;
  uptime: () => number;
  memoryUsage: () => NodeJS.MemoryUsage;
  activeResources: () => string[];
  beforeSample: () => void;
  pid: number;
}

export function diagnosticsSampleContext(
  options: SdDiagnosticsOptions,
): SdDiagnosticsSampleContext {
  return {
    phase: options.initialPhase ?? 'startup',
    now: options.now ?? Date.now,
    uptime: options.uptime ?? process.uptime,
    memoryUsage: options.memoryUsage ?? process.memoryUsage,
    activeResources: options.activeResources ?? process.getActiveResourcesInfo,
    beforeSample: options.beforeSample ?? noOp,
    pid: process.pid,
  };
}

export function collectDiagnosticsSample(context: SdDiagnosticsSampleContext): SdDiagnosticsSample {
  runBeforeSample(context.beforeSample);
  const memory = context.memoryUsage();
  return {
    schemaVersion: SD_DIAGNOSTICS_SCHEMA_VERSION,
    sampledAt: timestamp(context.now()),
    uptimeSeconds: finiteNumber(context.uptime()),
    phase: diagnosticsPhase(context.phase),
    process: {
      pid: nonNegativeInteger(context.pid),
      memoryBytes: {
        rss: nonNegativeInteger(memory.rss),
        heapTotal: nonNegativeInteger(memory.heapTotal),
        heapUsed: nonNegativeInteger(memory.heapUsed),
        external: nonNegativeInteger(memory.external),
        arrayBuffers: nonNegativeInteger(memory.arrayBuffers),
      },
    },
    resources: diagnosticsResourceCounts(context.activeResources()),
    wasmPages: diagnosticsWasmPages(),
  };
}

function runBeforeSample(beforeSample: () => void): void {
  try {
    beforeSample();
  } catch {
    // Diagnostics hooks must not affect the observed process.
  }
}

function noOp(): void {}

export function diagnosticsPhase(value: unknown): SdDiagnosticsPhase {
  return typeof value === 'string' && PHASES.has(value as SdDiagnosticsPhase)
    ? (value as SdDiagnosticsPhase)
    : 'unknown';
}

function timestamp(value: number): string {
  return new Date(Number.isFinite(value) ? value : 0).toISOString();
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
