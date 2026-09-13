import { createConnection } from 'node:net';
import {
  encodeIpcRequest,
  type IpcResponse,
  MAX_GATEWAY_IPC_FRAME_BYTES,
  parseIpcResponse,
} from './rust-ipc-frame.js';

export { MAX_GATEWAY_IPC_FRAME_BYTES } from './rust-ipc-frame.js';

export function request(
  socketPath: string,
  payload: unknown,
  timeoutMs: number,
): Promise<IpcResponse> {
  let encoded: ReturnType<typeof encodeIpcRequest>;
  try {
    encoded = encodeIpcRequest(payload);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let settled = false;
    let buffer = Buffer.alloc(0);
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      settle(() => {
        socket.destroy();
        reject(new Error(`Gateway IPC timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    socket.on('connect', () => socket.write(encoded.outbound));
    socket.on('data', (chunk) => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_GATEWAY_IPC_FRAME_BYTES + 1) {
        settle(() => {
          socket.destroy();
          reject(new Error(`Gateway IPC response exceeds ${MAX_GATEWAY_IPC_FRAME_BYTES} bytes`));
        });
        return;
      }
      const lineEnd = buffer.indexOf(0x0a);
      if (lineEnd < 0) return;
      let response: IpcResponse;
      try {
        response = parseIpcResponse(buffer, lineEnd);
      } catch (error) {
        settle(() => {
          socket.destroy();
          reject(error);
        });
        return;
      }
      if (response.id !== encoded.id) {
        settle(() => {
          socket.destroy();
          reject(
            new Error(`Gateway IPC response id ${response.id} did not match request ${encoded.id}`),
          );
        });
        return;
      }
      settle(() => {
        socket.destroy();
        resolve(response);
      });
    });
    socket.on('error', (error) =>
      settle(() => {
        socket.destroy();
        reject(error);
      }),
    );
    socket.on('close', () => {
      settle(() => reject(new Error('Gateway IPC connection closed before a response')));
    });
  });
}
