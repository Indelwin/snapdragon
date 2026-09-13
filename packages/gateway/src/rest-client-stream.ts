import { type RequestOptions, worldSearch } from './rest-client-request.js';
import { readGatewaySnapshotStream } from './rest-client-sse.js';
import type { GatewayRestStreamOptions } from './rest-client-types.js';
import type { GatewayWorldSnapshot } from './types-runtime.js';

type RestRequest = (path: string, options?: RequestOptions) => Promise<Response>;

export async function* streamGatewayWorldSnapshots(
  request: RestRequest,
  options: GatewayRestStreamOptions,
): AsyncIterable<GatewayWorldSnapshot> {
  const { signal, ...worldOptions } = options;
  const response = await request('stream', {
    headers: { accept: 'text/event-stream' },
    search: worldSearch(worldOptions),
    signal,
  });
  yield* readGatewaySnapshotStream(response);
}
