export type LearnEnvironmentKind =
  | 'local'
  | 'prime'
  | 'sandbox'
  | 'browser'
  | 'gateway'
  | 'external';

export interface LearnEnvironment {
  id: string;
  kind: LearnEnvironmentKind;
  name?: string;
  description?: string;
  args?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SandboxPort {
  port: number;
  protocol?: 'HTTP' | 'TCP';
  name?: string;
}

export interface SandboxSpec {
  image?: string;
  startCommand?: string;
  cwd?: string;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  labels?: string[];
  timeoutMinutes?: number;
  cpuCores?: number;
  memoryGb?: number;
  diskSizeGb?: number;
  gpuCount?: number;
  network?: 'disabled' | 'restricted' | 'enabled';
  exposedPorts?: SandboxPort[];
}
