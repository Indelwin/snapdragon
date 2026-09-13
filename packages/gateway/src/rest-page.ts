import { RestHttpError } from './rest-types.js';

export const MAX_REST_PAGE_ITEMS = 100;

export interface GatewayRestPage<T> {
  items: T[];
  nextCursor?: string;
}

export function paginateRest<T>(values: T[], search: URLSearchParams): GatewayRestPage<T> {
  const cursor = search.get('cursor') ?? '0';
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RestHttpError(400, 'invalid list cursor');
  }
  const requested = Number(search.get('limit') ?? MAX_REST_PAGE_ITEMS);
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new RestHttpError(400, 'limit must be a positive integer');
  }
  const limit = Math.min(requested, MAX_REST_PAGE_ITEMS);
  const items = values.slice(offset, offset + limit);
  const next = offset + items.length;
  return {
    items,
    nextCursor: next < values.length ? String(next) : undefined,
  };
}
