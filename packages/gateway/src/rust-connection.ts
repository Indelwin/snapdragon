import type { RustGatewayCall } from './rust-call.js';
import { request } from './rust-ipc.js';

export class RustGatewayConnection {
  #nextId = 1;

  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs: number,
  ) {}

  readonly call: RustGatewayCall = async (
    method,
    params = {},
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> => {
    const id = this.#nextId++;
    const response = await request(this.socketPath, { id, method, params }, timeoutMs);
    if (response.id !== id) {
      throw new Error(
        `Gateway IPC ${method} response id ${response.id} did not match request ${id}`,
      );
    }
    if (!response.ok) throw new Error(response.error ?? `Gateway IPC ${method} failed`);
    return response.result;
  };
}
