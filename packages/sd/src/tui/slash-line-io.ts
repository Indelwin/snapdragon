import { Writable } from 'node:stream';
import { defaultIo, type SdIo } from '../repl.js';

export function memoryIo(): { io: SdIo; output(): string; error(): string } {
  let output = '';
  let error = '';
  return {
    io: {
      input: defaultIo.input,
      output: new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }),
      error: new Writable({
        write(chunk, _encoding, callback) {
          error += chunk.toString();
          callback();
        },
      }),
    },
    output: () => output,
    error: () => error,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
