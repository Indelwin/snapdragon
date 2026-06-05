export type RestHeaders = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

export interface GatewayRestClientOptions {
  baseUrl: string | URL;
  fetch?: typeof fetch;
  headers?: RestHeaders;
}

export function normalizeRestClientOptions(
  options: GatewayRestClientOptions | string | URL,
): GatewayRestClientOptions {
  return typeof options === 'string' || options instanceof URL ? { baseUrl: options } : options;
}

export function normalizeRestBaseUrl(baseUrl: string | URL): URL {
  const url = new URL(baseUrl);
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url;
}

export async function resolveRestHeaders(
  headers: RestHeaders | undefined,
): Promise<HeadersInit | undefined> {
  return typeof headers === 'function' ? headers() : headers;
}

export function appendNumberParam(
  searchParams: URLSearchParams,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined) searchParams.set(key, String(value));
}
