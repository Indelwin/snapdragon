import { GatewayRestClientError } from './rest-client-types.js';

export async function readRestJson<T>(response: Response): Promise<T> {
  const body = await readBody(response);
  if (!response.ok) throw restError(response.status, body);
  return body as T;
}

export async function assertRestOk(response: Response): Promise<void> {
  if (response.ok) return;
  throw restError(response.status, await readBody(response));
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function restError(status: number, body: unknown): GatewayRestClientError {
  return new GatewayRestClientError(status, errorMessage(status, body), body);
}

function errorMessage(status: number, body: unknown): string {
  if (isErrorBody(body)) return String(body.error);
  return `Gateway REST request failed with status ${status}`;
}

function isErrorBody(body: unknown): body is { error: unknown } {
  return typeof body === 'object' && body !== null && 'error' in body;
}
