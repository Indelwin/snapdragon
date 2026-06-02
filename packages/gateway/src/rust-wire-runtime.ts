import { normalizeGatewayAgentRuntimeDescriptor } from './agent-runtime-validation.js';
import type {
  GatewayAgentRuntimeDescriptor,
  GatewayAgentRuntimeHealth,
  GatewayAgentRuntimeIsolation,
  GatewayAgentRuntimeKind,
  GatewayAgentRuntimeProtocol,
} from './types-runtime.js';

interface WireAgentRuntimeDescriptor {
  id: string;
  kind: string;
  protocol: string;
  label?: string | null;
  command?: {
    command: string;
    args?: string[];
    cwd?: string | null;
    env?: Record<string, string>;
  } | null;
  supported_job_kinds?: string[];
  capabilities?: string[];
  isolation?: string | null;
  health?: {
    state: string;
    checked_at_ms: number;
    message?: string | null;
  } | null;
  metadata?: Record<string, unknown> | null;
}

export function toWireAgentRuntimeDescriptor(
  descriptor: GatewayAgentRuntimeDescriptor,
): Record<string, unknown> {
  const normalized = normalizeGatewayAgentRuntimeDescriptor(descriptor);
  return {
    id: normalized.id,
    kind: normalized.kind,
    protocol: normalized.protocol,
    label: normalized.label ?? null,
    command: normalized.command
      ? {
          command: normalized.command.command,
          args: normalized.command.args ?? [],
          cwd: normalized.command.cwd ?? null,
          env: normalized.command.env ?? {},
        }
      : null,
    supported_job_kinds: normalized.supportedJobKinds ?? [],
    capabilities: normalized.capabilities ?? [],
    isolation: normalized.isolation ?? null,
    health: normalized.health
      ? {
          state: normalized.health.state,
          checked_at_ms: normalized.health.checkedAtMs,
          message: normalized.health.message ?? null,
        }
      : null,
    metadata: normalized.metadata ?? null,
  };
}

export function fromWireAgentRuntimeDescriptor(
  value: WireAgentRuntimeDescriptor | undefined,
): GatewayAgentRuntimeDescriptor | undefined {
  if (!value) return undefined;
  return {
    id: value.id,
    kind: fromWireRuntimeKind(value.kind),
    protocol: fromWireProtocol(value.protocol),
    label: value.label ?? undefined,
    command: value.command
      ? {
          command: value.command.command,
          args: value.command.args ?? [],
          cwd: value.command.cwd ?? undefined,
          env: value.command.env ?? {},
        }
      : undefined,
    supportedJobKinds: value.supported_job_kinds ?? [],
    capabilities: value.capabilities ?? [],
    isolation: value.isolation ? fromWireIsolation(value.isolation) : undefined,
    health: value.health ? fromWireHealth(value.health) : undefined,
    metadata: value.metadata ?? undefined,
  };
}

function fromWireHealth(
  value: NonNullable<WireAgentRuntimeDescriptor['health']>,
): GatewayAgentRuntimeHealth {
  return {
    state: value.state,
    checkedAtMs: Number(value.checked_at_ms ?? 0),
    message: value.message ?? undefined,
  };
}

function fromWireRuntimeKind(value: string): GatewayAgentRuntimeKind {
  return runtimeKindByWire[normalizeEnum(value)] ?? 'custom';
}

function fromWireProtocol(value: string): GatewayAgentRuntimeProtocol {
  return protocolByWire[normalizeEnum(value)] ?? 'command';
}

function fromWireIsolation(value: string): GatewayAgentRuntimeIsolation {
  return isolationByWire[normalizeEnum(value)] ?? 'inherit';
}

function normalizeEnum(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

const runtimeKindByWire: Record<string, GatewayAgentRuntimeKind> = {
  sd: 'sd',
  codex: 'codex',
  hermes: 'hermes',
  pi: 'pi',
  custom: 'custom',
};

const protocolByWire: Record<string, GatewayAgentRuntimeProtocol> = {
  embedded: 'embedded',
  command: 'command',
  jsonl: 'jsonl',
  http: 'http',
  stdio: 'stdio',
};

const isolationByWire: Record<string, GatewayAgentRuntimeIsolation> = {
  inherit: 'inherit',
  profile: 'profile',
  channel: 'channel',
  sandbox: 'sandbox',
};
