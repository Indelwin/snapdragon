import type { Readable } from 'node:stream';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export class PiRpcLineTooLongError extends Error {
  readonly code = 'PI_RPC_LINE_TOO_LONG';

  constructor(
    readonly maxLineBytes: number,
    readonly observedBytes: number,
  ) {
    super(
      `Pi RPC JSONL line exceeded maxLineBytes=${maxLineBytes} ` +
        `(observed at least ${observedBytes} bytes)`,
    );
    this.name = 'PiRpcLineTooLongError';
  }
}

export async function* boundedJsonLines(
  input: Readable,
  maxLineBytes: number,
): AsyncGenerator<string> {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
    throw new Error(
      `Pi RPC maxLineBytes must be a positive safe integer, received ${maxLineBytes}`,
    );
  }

  let fragments: Buffer[] = [];
  let fragmentBytes = 0;
  for await (const value of input) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(NEWLINE, offset);
      const end = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(offset, end);
      assertLineWithinLimit(fragmentBytes + segment.length, maxLineBytes);
      if (segment.length > 0) {
        fragments.push(segment);
        fragmentBytes += segment.length;
      }
      if (newline < 0) break;
      yield decodeLine(fragments, fragmentBytes);
      fragments = [];
      fragmentBytes = 0;
      offset = newline + 1;
    }
  }

  if (fragmentBytes > 0) yield decodeLine(fragments, fragmentBytes);
}

function assertLineWithinLimit(observedBytes: number, maxLineBytes: number): void {
  if (observedBytes > maxLineBytes) {
    throw new PiRpcLineTooLongError(maxLineBytes, observedBytes);
  }
}

function decodeLine(fragments: Buffer[], bytes: number): string {
  const line =
    fragments.length === 1 ? (fragments[0] ?? Buffer.alloc(0)) : Buffer.concat(fragments, bytes);
  const end = line.at(-1) === CARRIAGE_RETURN ? line.length - 1 : line.length;
  return line.toString('utf8', 0, end);
}
