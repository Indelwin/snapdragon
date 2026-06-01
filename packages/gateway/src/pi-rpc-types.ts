import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { GatewayAgentRuntimeDescriptor } from './types.js';
import type { GatewayAgentRuntimeObservedEvent } from './types-runtime.js';

export interface PiRpcRuntimeOptions {
  id?: string;
  label?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  agentDir?: string;
  sessionDir?: string;
  inheritEnv?: boolean;
  timeoutMs?: number;
  shutdownGraceMs?: number;
}

export interface PiRpcAgentJobOptions extends PiRpcRuntimeOptions {
  descriptor?: GatewayAgentRuntimeDescriptor;
  signal?: AbortSignal;
  onEvent?: (event: PiRpcObservedEvent) => void | Promise<void>;
}

export interface PiRpcObservedEvent extends GatewayAgentRuntimeObservedEvent {}

export interface PiRpcAgentRunResult {
  summary?: string;
  content: string;
  metrics: Record<string, number>;
  events: PiRpcObservedEvent[];
  state?: unknown;
  outputArtifact?: string;
}

export interface PiRpcSession {
  child: ChildProcessWithoutNullStreams;
  send(command: Record<string, unknown>): Promise<PiRpcResponse>;
  write(message: Record<string, unknown>): void;
  stop(): Promise<void>;
  onEvent(listener: (event: Record<string, unknown>) => void): void;
}

export interface PiRpcResponse {
  id?: string;
  command?: string;
  success?: boolean;
  data?: unknown;
  error?: string;
}

export interface PiRpcProcessSpec {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
}

export const DEFAULT_PI_COMMAND = 'pi';
export const DEFAULT_RPC_ARGS = ['--mode', 'rpc'];
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;
