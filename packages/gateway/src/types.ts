export type GatewayRuntime = 'rust' | 'inline-ts';

export interface ActorId {
  id: string;
}

export interface GatewayEnvelope {
  id: number;
  kind: string;
  target: ActorId;
  source?: ActorId;
  correlationId?: string;
  capability?: string;
  payload: unknown;
  insertedAtMs: number;
}

export interface GatewayReceiveFilter {
  kind?: string;
  source?: ActorId;
  correlationId?: string;
  capability?: string;
}

export type GatewaySupervisorStrategy = 'one_for_one' | 'one_for_all' | 'rest_for_one';
export type GatewayChildRestart = 'permanent' | 'transient' | 'temporary';
export type GatewayTableAccess = 'public' | 'protected' | 'private';
export type GatewayServiceState = 'starting' | 'running' | 'stopped' | 'failed';

export interface GatewayBudgetConfig {
  maxFuel?: number;
  timeoutMs?: number;
}

export interface GatewayServiceWorkerSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface GatewayServiceSpec {
  name: string;
  enabled?: boolean;
  intervalMs?: number;
  startupDelayMs?: number;
  budget?: GatewayBudgetConfig;
  restart?: GatewayChildRestart;
  worker?: GatewayServiceWorkerSpec;
}

export interface GatewayServiceStatus {
  name: string;
  enabled: boolean;
  state: GatewayServiceState;
  runs: number;
  errors: number;
  lastRunAtMs?: number;
  lastError?: string;
  lastSummary?: string;
}

export interface GatewayStatus {
  runtime: GatewayRuntime;
  services: GatewayServiceStatus[];
  processes: number;
  tables: string[];
}

export interface GatewayRegistrySnapshot {
  names: Record<string, ActorId>;
  capabilities: Record<string, ActorId[]>;
  channels: Record<string, ActorId>;
}

export interface GatewayTableSnapshot {
  name: string;
  owner: ActorId;
  access: GatewayTableAccess;
  rows: number;
}

export interface GatewayExtensionContributions {
  services?: GatewayServiceSpec[];
  appliances?: GatewayApplianceDescriptor[];
  capabilities?: string[];
}

export interface GatewayApplianceDescriptor {
  id: string;
  name: string;
  version?: string;
  root?: string;
  capabilities?: string[];
  resources?: string[];
}

export interface GatewayTransport {
  readonly runtime: GatewayRuntime;
  send(envelope: GatewayEnvelope): Promise<void>;
  receive(actor: ActorId, filter?: GatewayReceiveFilter): Promise<GatewayEnvelope | undefined>;
  status(): Promise<GatewayStatus>;
}

export interface GatewayServiceRunner {
  run(signal?: AbortSignal): Promise<{ summary?: string } | undefined>;
}

export interface GatewayClient extends GatewayTransport {
  registerService(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): Promise<void>;
  enableService(name: string, enabled: boolean): Promise<void>;
  runService(name: string, signal?: AbortSignal): Promise<GatewayServiceStatus | undefined>;
  listServices(): Promise<GatewayServiceStatus[]>;
  registerCapability(capability: string, actor: ActorId): Promise<void>;
  whereisCapability(capability: string): Promise<ActorId[]>;
  registrySnapshot(): Promise<GatewayRegistrySnapshot>;
  createTable(name: string, owner: ActorId, access?: GatewayTableAccess): Promise<boolean>;
  tableNames(): Promise<string[]>;
  tableSnapshot(name: string): Promise<GatewayTableSnapshot | undefined>;
}
