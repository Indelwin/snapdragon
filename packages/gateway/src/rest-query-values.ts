import type {
  GatewayEventState,
  GatewayJobState,
  GatewayServiceState,
  GatewayWorkerProcessState,
  GatewayWorkerState,
} from './types.js';

const booleanValues = new Map<string, boolean>([
  ['1', true],
  ['true', true],
  ['yes', true],
  ['on', true],
  ['0', false],
  ['false', false],
  ['no', false],
  ['off', false],
]);

const jobStates = new Set<GatewayJobState>([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
const eventStates = new Set<GatewayEventState>([
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
]);
const serviceStates = new Set<GatewayServiceState>(['starting', 'running', 'stopped', 'failed']);
const workerProcessStates = new Set<GatewayWorkerProcessState>([
  'running',
  'exited',
  'timed_out',
  'failed',
]);
const workerStates = new Set<GatewayWorkerState | GatewayWorkerProcessState>([
  'idle',
  'running',
  'offline',
  'exited',
  'timed_out',
  'failed',
]);

export function booleanParam(value: string | undefined): boolean | undefined {
  return value === undefined ? undefined : booleanValues.get(value.toLowerCase());
}

export function jobStateParam(value: string | undefined): GatewayJobState | undefined {
  return stateParam(value, jobStates);
}

export function eventStateParam(value: string | undefined): GatewayEventState | undefined {
  return stateParam(value, eventStates);
}

export function serviceStateParam(value: string | undefined): GatewayServiceState | undefined {
  return stateParam(value, serviceStates);
}

export function workerProcessStateParam(
  value: string | undefined,
): GatewayWorkerProcessState | undefined {
  return stateParam(value, workerProcessStates);
}

export function workerStateParam(
  value: string | undefined,
): GatewayWorkerState | GatewayWorkerProcessState | undefined {
  return stateParam(value, workerStates);
}

function stateParam<State extends string>(
  value: string | undefined,
  allowed: Set<State>,
): State | undefined {
  return value && allowed.has(value as State) ? (value as State) : undefined;
}
