import type { QueryValue, RequestOptions } from './rest-client-request.js';
import { type GatewayRestPage, MAX_REST_PAGE_ITEMS } from './rest-page.js';

type RestGet = <T>(path: string, options?: RequestOptions) => Promise<T>;

export async function readAllRestPages<T>(
  get: RestGet,
  path: string,
  search: Record<string, QueryValue> = {},
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const result = await get<GatewayRestPage<T> | T[]>(path, {
      search: { ...search, cursor, limit: MAX_REST_PAGE_ITEMS },
    });
    if (Array.isArray(result)) return [...items, ...result];
    items.push(...result.items);
    if (!result.nextCursor) return items;
    if (result.nextCursor === cursor) throw new Error(`Gateway REST ${path} repeated a cursor`);
    cursor = result.nextCursor;
  }
}
