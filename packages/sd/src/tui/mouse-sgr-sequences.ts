const MOUSE_PREFIX = Buffer.from('\x1b[<');
const MAX_MOUSE_SEQUENCE_BYTES = 24;
const COMPLETE_MOUSE_RE = /^(\d{1,6});\d{1,6};\d{1,6}[Mm]/;
const PARTIAL_MOUSE_RE = /^(?:\d{0,6}|\d{1,6};\d{0,6}|\d{1,6};\d{1,6};\d{0,6})$/;

export type MouseSequenceMatch =
  | { state: 'complete'; end: number; button: number; released: boolean }
  | { state: 'partial' }
  | { state: 'none' };

export function matchFixedSequence(
  input: Buffer,
  offset: number,
  sequence: Buffer,
): 'complete' | 'partial' | 'none' {
  const available = input.length - offset;
  const compared = Math.min(available, sequence.length);
  for (let index = 0; index < compared; index += 1) {
    if (input[offset + index] !== sequence[index]) return 'none';
  }
  return available < sequence.length ? 'partial' : 'complete';
}

export function matchMouseSequence(input: Buffer, offset: number): MouseSequenceMatch {
  const prefix = matchFixedSequence(input, offset, MOUSE_PREFIX);
  if (prefix === 'none') return { state: 'none' };
  if (prefix === 'partial') return { state: 'partial' };

  const available = input.length - offset;
  const candidate = input
    .subarray(offset + MOUSE_PREFIX.length, offset + MAX_MOUSE_SEQUENCE_BYTES + 1)
    .toString('latin1');
  const complete = COMPLETE_MOUSE_RE.exec(candidate);
  if (complete) {
    return {
      state: 'complete',
      end: offset + MOUSE_PREFIX.length + complete[0].length,
      button: Number(complete[1]),
      released: complete[0].endsWith('m'),
    };
  }
  if (available <= MAX_MOUSE_SEQUENCE_BYTES && PARTIAL_MOUSE_RE.test(candidate)) {
    return { state: 'partial' };
  }
  return { state: 'none' };
}

export function trailingPrefixLength(input: Buffer, sequence: Buffer): number {
  const maximum = Math.min(input.length, sequence.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (input.subarray(input.length - length).equals(sequence.subarray(0, length))) return length;
  }
  return 0;
}
