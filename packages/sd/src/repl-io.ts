import { stderr, stdin, stdout } from 'node:process';

export interface SdIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  error: NodeJS.WritableStream;
}

export const defaultIo: SdIo = { input: stdin, output: stdout, error: stderr };
