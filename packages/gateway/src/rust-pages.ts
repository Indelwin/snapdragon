import type { RustGatewayCall } from './rust-call.js';

interface WirePage {
  items?: unknown[];
  next_cursor?: string | null;
}

const PAGE_LIMIT = 100;

export async function readAllRustPages<T>(
  call: RustGatewayCall,
  method: string,
  convert: (value: unknown) => T | undefined,
): Promise<T[]> {
  const values: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = (await call(method, { cursor, limit: PAGE_LIMIT })) as WirePage;
    for (const item of page.items ?? []) {
      const converted = convert(item);
      if (converted !== undefined) values.push(converted);
    }
    const next = page.next_cursor ?? undefined;
    if (!next) return values;
    if (next === cursor) throw new Error(`Gateway IPC ${method} returned a repeated cursor`);
    cursor = next;
  }
}
