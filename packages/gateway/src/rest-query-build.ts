import type { GatewayWorldSnapshotOptions } from './types-runtime.js';

export function worldSnapshotOptionsToSearchParams(
  options: GatewayWorldSnapshotOptions = {},
): URLSearchParams {
  const searchParams = new URLSearchParams();
  appendList(searchParams, 'sections', options.sections);
  append(searchParams, 'target', options.target);
  append(searchParams, 'queue', options.queue);
  append(searchParams, 'runtime', options.runtimeId);
  append(searchParams, 'service', options.service);
  append(searchParams, 'worker', options.worker);
  append(searchParams, 'capability', options.capability);
  append(searchParams, 'kind', options.jobKind);
  append(searchParams, 'eventKind', options.eventKind);
  append(searchParams, 'serviceState', options.serviceState);
  append(searchParams, 'workerState', options.workerState);
  append(searchParams, 'jobState', options.jobState);
  append(searchParams, 'eventState', options.eventState);
  append(searchParams, 'enabled', booleanParam(options.serviceEnabled));
  append(searchParams, 'logLimit', positiveIntParam(options.logLimit));
  appendList(searchParams, 'tables', options.tables);
  return searchParams;
}

function append(searchParams: URLSearchParams, key: string, value: string | undefined): void {
  if (value) searchParams.set(key, value);
}

function appendList(
  searchParams: URLSearchParams,
  key: string,
  values: readonly string[] | undefined,
): void {
  const clean = values?.map((value) => value.trim()).filter((value) => value.length > 0);
  if (clean?.length) searchParams.set(key, clean.join(','));
}

function booleanParam(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return String(value);
}

function positiveIntParam(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return undefined;
  return String(value);
}
