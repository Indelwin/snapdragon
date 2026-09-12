export const SD_DIAGNOSTICS_SCHEMA_VERSION = 1 as const;
export const SD_DIAGNOSTICS_INTERVAL_MS = 10_000;
export const SD_DIAGNOSTICS_MAX_FILE_BYTES = 1024 * 1024;
export const SD_DIAGNOSTICS_MAX_FILES = 3;

export type SdDiagnosticsPhase =
  | 'startup'
  | 'idle'
  | 'running'
  | 'provider'
  | 'tool'
  | 'shutdown'
  | 'unknown';

export type SdDiagnosticsWasmModule = 'core' | 'webtools';
export type SdDiagnosticsWasmPageGetter = () => number | null | undefined;

export interface SdDiagnosticsSample {
  schemaVersion: typeof SD_DIAGNOSTICS_SCHEMA_VERSION;
  sampledAt: string;
  uptimeSeconds: number;
  phase: SdDiagnosticsPhase;
  process: {
    pid: number;
    memoryBytes: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
  };
  resources: {
    total: number;
    fileSystem: number;
    network: number;
    timers: number;
    processes: number;
    signals: number;
    terminal: number;
    other: number;
  };
  wasmPages: {
    core: number | null;
    webtools: number | null;
  };
}

export interface SdDiagnosticsOptions {
  enabled?: boolean;
  directory?: string;
  intervalMs?: number;
  maxFileBytes?: number;
  maxFiles?: number;
  signal?: AbortSignal;
  initialPhase?: SdDiagnosticsPhase;
  now?: () => number;
  uptime?: () => number;
  memoryUsage?: () => NodeJS.MemoryUsage;
  activeResources?: () => string[];
  beforeSample?: () => void;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface SdDiagnosticsHandle {
  readonly enabled: boolean;
  readonly path: string | null;
  setPhase(phase: SdDiagnosticsPhase): void;
  sample(): Promise<void>;
  flush(): Promise<void>;
  stop(): Promise<void>;
}
