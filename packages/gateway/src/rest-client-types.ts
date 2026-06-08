import type { GatewayRuntime } from './types.js';

export interface GatewayRestClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface GatewayRestHealth {
  ok: boolean;
  runtime: GatewayRuntime;
}

export interface GatewayRestStreamOptions {
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
