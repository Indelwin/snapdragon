import { createConnection } from 'node:net';

interface IpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function request(
  socketPath: string,
  payload: unknown,
  timeoutMs: number,
): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Gateway IPC timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let buffer = '';
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) return;
      clearTimeout(timer);
      socket.end();
      resolve(JSON.parse(buffer.slice(0, lineEnd)) as IpcResponse);
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
