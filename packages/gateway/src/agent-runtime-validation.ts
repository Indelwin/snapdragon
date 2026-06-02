import { normalizeRuntimeCommand } from './agent-runtime-validation-command.js';
import {
  enumValue,
  optionalIsolation,
  runtimeId,
  stringList,
} from './agent-runtime-validation-fields.js';
import type {
  GatewayAgentRuntimeDescriptor,
  GatewayAgentRuntimeIsolation,
  GatewayAgentRuntimeKind,
  GatewayAgentRuntimeProtocol,
} from './types.js';

const commandProtocols = new Set<GatewayAgentRuntimeProtocol>(['command', 'jsonl', 'stdio']);
const runtimeKinds = new Set<GatewayAgentRuntimeKind>(['sd', 'codex', 'hermes', 'pi', 'custom']);
const runtimeProtocols = new Set<GatewayAgentRuntimeProtocol>([
  'embedded',
  'command',
  'jsonl',
  'http',
  'stdio',
]);
const runtimeIsolations = new Set<GatewayAgentRuntimeIsolation>([
  'inherit',
  'profile',
  'channel',
  'sandbox',
]);

export function normalizeGatewayAgentRuntimeDescriptor(
  descriptor: GatewayAgentRuntimeDescriptor,
): GatewayAgentRuntimeDescriptor {
  const candidate = descriptor as unknown as Record<string, unknown>;
  const id = runtimeId(candidate.id);
  const kind = enumValue('kind', candidate.kind, runtimeKinds);
  const protocol = enumValue('protocol', candidate.protocol, runtimeProtocols);
  const command = normalizeRuntimeCommand(candidate.command);
  if (commandProtocols.has(protocol) && !command) {
    throw new Error(`gateway agent runtime ${id} protocol ${protocol} requires command.command`);
  }
  return {
    ...descriptor,
    id,
    kind,
    protocol,
    command,
    supportedJobKinds: stringList('supportedJobKinds', candidate.supportedJobKinds),
    capabilities: stringList('capabilities', candidate.capabilities),
    isolation: optionalIsolation(candidate.isolation, runtimeIsolations),
  };
}
