export interface IpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export const MAX_GATEWAY_IPC_FRAME_BYTES = 1024 * 1024;

export function encodeIpcRequest(payload: unknown): { id: number; outbound: Buffer } {
  const id = (payload as { id?: unknown } | null)?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
    throw new Error('Gateway IPC request requires a numeric id');
  }
  let outbound: Buffer;
  try {
    outbound = Buffer.from(`${JSON.stringify(payload)}\n`);
  } catch (error) {
    throw new Error(`Gateway IPC request is not valid JSON: ${String(error)}`);
  }
  if (outbound.length > MAX_GATEWAY_IPC_FRAME_BYTES + 1) {
    throw new Error(`Gateway IPC request exceeds ${MAX_GATEWAY_IPC_FRAME_BYTES} bytes`);
  }
  return { id, outbound };
}

export function parseIpcResponse(buffer: Buffer, lineEnd: number): IpcResponse {
  try {
    const response = JSON.parse(buffer.subarray(0, lineEnd).toString('utf8')) as IpcResponse;
    if (!response || typeof response.id !== 'number' || typeof response.ok !== 'boolean') {
      throw new Error('response is missing id or ok');
    }
    return response;
  } catch (error) {
    throw new Error(`Malformed gateway IPC response: ${String(error)}`);
  }
}
