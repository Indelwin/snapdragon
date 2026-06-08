import type { GatewayRuntime } from './types.js';
import type { GatewayWorldSnapshotOptions } from './types-runtime.js';

export interface GatewayRestClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface GatewayRestHealth {
  ok: boolean;
  runtime: GatewayRuntime;
}

export interface GatewayRestStreamOptions extends GatewayWorldSnapshotOptions {
  signal?: AbortSignal;
}

export class GatewayRestClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'GatewayRestClientError';
  }
}
