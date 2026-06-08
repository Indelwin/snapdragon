import type { GatewayLogInput, GatewayLogRecord } from './types.js';

export class InlineLogStore {
  #logs: GatewayLogRecord[] = [];

  appendInput(input: GatewayLogInput): GatewayLogRecord {
    return this.append({
      level: input.level ?? 'info',
      target: input.target,
      message: input.message,
      data: input.data,
      atMs: input.atMs,
    });
  }

  append(input: {
    level: string;
    target?: string;
    message: string;
    data?: unknown;
    atMs?: number;
  }): GatewayLogRecord {
    const record = {
      id: this.#logs.length + 1,
      atMs: input.atMs ?? Date.now(),
      level: input.level,
      target: input.target,
      message: input.message,
      data: input.data,
    };
    this.#logs.push(record);
    return record;
  }

  tail(options: { target?: string; limit?: number } = {}): GatewayLogRecord[] {
    const logs = options.target
      ? this.#logs.filter((log) => log.target === options.target)
      : this.#logs;
    return logs.slice(-(options.limit ?? 20));
  }

  failures(limit: number): GatewayLogRecord[] {
    return this.#logs.filter((log) => log.level === 'error' || log.level === 'warn').slice(-limit);
  }
}
