import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  createMouseInputAdapter,
  MOUSE_WHEEL_COALESCE_MS,
  SdMouseInputAdapter,
} from '../src/tui/mouse-input-adapter.ts';
import { MouseSgrParser } from '../src/tui/mouse-sgr-parser.ts';

test('raw adapter consumes fragmented and coalesced SGR mouse reports before Ink', () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter(io);
  const received = collect(adapter);

  io.input.write(Buffer.from('before\x1b['));
  io.input.write(Buffer.from('<64;10;5Mmiddle\x1b[<0;2;3M\x1b[<65;10;5Mafter'));

  assert.equal(join(received), 'beforemiddleafter');
  adapter.dispose();
});

test('ordinary text, numeric lookalikes, and malformed mouse-like input remain byte exact', () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter(io);
  const received = collect(adapter);
  const ordinary = Buffer.concat([
    Buffer.from('hello 35;75;54M [<64;10;5M \x1b[A \x1b[<0;10M \x1b[<a;10;5M cafe'),
    Buffer.from([0xc3, 0xa9]),
    Buffer.from(' \x1b[<1234567;1;1M '),
    Buffer.from([0x1b, 0x5b, 0x3c, 0xb1, 0x3b, 0x31, 0x3b, 0x31, 0x4d]),
  ]);

  io.input.write(ordinary.subarray(0, ordinary.length - 2));
  io.input.write(ordinary.subarray(ordinary.length - 2));

  assert.deepEqual(Buffer.concat(received), ordinary);
  adapter.dispose();
});

test('Ink-style UTF-8 decoding preserves truly fragmented multibyte input', async () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter(io);
  const received: string[] = [];
  adapter.setEncoding('utf8');
  adapter.on('readable', () => {
    for (;;) {
      const chunk: unknown = adapter.read();
      if (chunk === null) break;
      assert.equal(typeof chunk, 'string');
      received.push(chunk as string);
    }
  });

  const text = Buffer.from('café 😀');
  const mouse = Buffer.from('\x1b[<64;10;5M');
  const payload = Buffer.concat([text, mouse, Buffer.from(' tail')]);
  writeSlices(io.input, payload, [4, 7, 8, text.length, text.length + 1, text.length + 5]);
  io.input.write(payload.subarray(text.length + 5));
  await delay(0);

  assert.equal(received.join(''), 'café 😀 tail');
  adapter.dispose();
});

test('small pending fragments do not retain a giant parent buffer', () => {
  const parser = new MouseSgrParser();
  const giant = Buffer.alloc(2 * 1024 * 1024, 0x61);
  giant[giant.length - 1] = 0x1b;

  const result = parser.push(giant);
  const pending = Reflect.get(parser, 'pending') as Buffer;

  assert.equal(result.output.length, giant.length - 1);
  assert.deepEqual(pending, Buffer.from([0x1b]));
  assert.ok(pending.buffer.byteLength < giant.buffer.byteLength);
});

test('recognized mouse fragments remain buffered beyond the Escape-key timeout', async () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter({
    ...io,
    fragmentTimeoutMs: 5,
    wheelCoalesceMs: 1,
  });
  const received = collect(adapter);
  const ticks: number[] = [];
  adapter.subscribeWheel((value) => ticks.push(value));

  io.input.write('\x1b[<64;');
  await delay(10);
  io.input.write('10;5M');
  await delay(5);

  assert.deepEqual(received, []);
  assert.deepEqual(ticks, [1]);
  adapter.dispose();
});

test('a standalone Escape byte is forwarded after the fragment timeout', async () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter({ ...io, fragmentTimeoutMs: 5 });
  const received = collect(adapter);

  io.input.write('\x1b');
  await delay(10);

  assert.equal(join(received), '\x1b');
  adapter.dispose();
});

test('bracketed paste is forwarded exactly even when it contains mouse reports', () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter(io);
  const received = collect(adapter);
  const pasted = Buffer.from('\x1b[200~one\x1b[<64;10;5Mtwo\n35;75;54M\x1b[201~tail');

  writeSlices(io.input, pasted, [2, 6, 13, 24, 37, pasted.length]);

  assert.deepEqual(Buffer.concat(received), pasted);
  adapter.dispose();
});

test('wheel ticks coalesce for 33ms and scroll direction is preserved', async () => {
  assert.equal(MOUSE_WHEEL_COALESCE_MS, 33);
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter(io);
  const ticks: number[] = [];
  const unsubscribe = adapter.subscribeWheel((value) => ticks.push(value));
  const deactivate = adapter.activate();

  io.input.write('\x1b[<64;10;5M\x1b[<64;10;5M\x1b[<65;10;5M');
  await delay(20);
  assert.deepEqual(ticks, []);
  await delay(25);
  assert.deepEqual(ticks, [1]);

  unsubscribe();
  deactivate();
  adapter.dispose();
});

test('lowercase SGR wheel releases are filtered without scrolling', async () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter({ ...io, wheelCoalesceMs: 1 });
  const received = collect(adapter);
  const ticks: number[] = [];
  adapter.subscribeWheel((value) => ticks.push(value));

  io.input.write('\x1b[<64;10;5m');
  await delay(5);

  assert.deepEqual(received, []);
  assert.deepEqual(ticks, []);
  adapter.dispose();
});

test('slow consumers bound adapter buffering and resume input only on downstream demand', async () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter(io);
  const chunk = Buffer.alloc(4096, 0x61);
  let writes = 0;

  while (io.input.readableFlowing === true && writes < 1000) {
    io.input.write(chunk);
    writes += 1;
  }

  assert.ok(writes < 1000, 'adapter did not pause its input source');
  assert.equal(io.input.readableFlowing, false);
  assert.ok(adapter.readableLength >= adapter.readableHighWaterMark);
  assert.ok(adapter.readableLength <= adapter.readableHighWaterMark + chunk.length);

  const bufferedAtPause = adapter.readableLength;
  io.input.write('tail');
  await delay(0);
  assert.equal(io.input.readableFlowing, false);
  assert.equal(adapter.readableLength, bufferedAtPause);
  assert.equal(io.input.readableLength, 4);

  const drained: Buffer[] = [];
  adapter.on('readable', () => {
    for (;;) {
      const value: Buffer | null = adapter.read();
      if (value === null) break;
      drained.push(Buffer.from(value));
    }
  });
  await delay(0);
  assert.equal(io.input.readableFlowing, true);
  assert.equal(Buffer.concat(drained).length, bufferedAtPause + 4);

  adapter.dispose();
  assert.equal(io.input.readableFlowing, null);
  io.input.write('kept');
  assert.equal(io.input.readableLength, 4);
});

test('dispose preserves an input source that was already flowing', () => {
  const io = createTtyIo();
  const upstream: Buffer[] = [];
  io.input.on('data', (chunk: Buffer) => upstream.push(Buffer.from(chunk)));
  assert.equal(io.input.readableFlowing, true);

  const adapter = new SdMouseInputAdapter(io);
  adapter.dispose();

  assert.equal(io.input.readableFlowing, true);
  io.input.write('still owned');
  assert.equal(join(upstream), 'still owned');
  io.input.pause();
});

test('dispose leaves an untouched input ready for its next data subscriber', () => {
  const io = createTtyIo();
  assert.equal(io.input.readableFlowing, null);
  const adapter = new SdMouseInputAdapter(io);
  adapter.dispose();
  assert.equal(io.input.readableFlowing, null);
  const received: Buffer[] = [];
  io.input.on('data', (chunk: Buffer) => received.push(chunk));
  io.input.write('next owner');
  assert.equal(join(received), 'next owner');
  io.input.destroy();
});

test('terminal modes use injected streams, omit motion reporting, and clean up on deactivate', async () => {
  const io = createTtyIo();
  const adapter = createMouseInputAdapter({
    enabled: true,
    input: io.input,
    output: io.output,
  });
  assert.ok(adapter);
  const ticks: number[] = [];
  adapter.subscribeWheel((value) => ticks.push(value));

  adapter.setRawMode(true);
  adapter.ref();
  adapter.unref();
  const deactivate = adapter.activate();
  io.input.write('\x1b[<64;1;1M');
  deactivate();
  await delay(MOUSE_WHEEL_COALESCE_MS + 5);

  assert.deepEqual(io.rawModes, [true]);
  assert.equal(io.refs, 1);
  assert.equal(io.unrefs, 1);
  assert.deepEqual(ticks, []);
  assert.equal(io.terminalOutput().includes('\x1b[?1000h\x1b[?1006h'), true);
  assert.equal(io.terminalOutput().includes('\x1b[?1006l\x1b[?1000l'), true);
  assert.doesNotMatch(io.terminalOutput(), /\?1003/);
  adapter.dispose();
  assert.deepEqual(io.rawModes, [true, false]);
  assert.equal(io.input.listenerCount('data'), 0);
});

test('source errors restore terminal mode, remove subscriptions, and reach the owner', () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter(io);
  const errors: Error[] = [];
  adapter.subscribeError((error) => errors.push(error));
  adapter.activate();
  adapter.ref();
  adapter.setRawMode(true);

  const failure = new Error('input failed');
  io.input.emit('error', failure);

  assert.deepEqual(errors, [failure]);
  assert.deepEqual(io.rawModes, [true, false]);
  assert.equal(io.unrefs, 1);
  assert.equal(io.input.listenerCount('data'), 0);
  assert.equal(io.terminalOutput().includes('\x1b[?1006l\x1b[?1000l'), true);
  adapter.dispose();
});

test('output errors also restore injected input and terminal state', () => {
  const io = createTtyIo();
  const adapter = new SdMouseInputAdapter(io);
  const errors: Error[] = [];
  adapter.subscribeError((error) => errors.push(error));
  adapter.activate();
  adapter.ref();
  adapter.setRawMode(true);

  const failure = new Error('output failed');
  io.output.emit('error', failure);

  assert.deepEqual(errors, [failure]);
  assert.deepEqual(io.rawModes, [true, false]);
  assert.equal(io.unrefs, 1);
  assert.equal(io.output.listenerCount('error'), 0);
  assert.equal(io.terminalOutput().includes('\x1b[?1006l\x1b[?1000l'), true);
  adapter.dispose();
});

test('adapter is disabled for non-TTY and mouse-disabled embedded IO', () => {
  const io = createTtyIo();
  assert.equal(
    createMouseInputAdapter({
      enabled: false,
      input: io.input,
      output: io.output,
    }),
    undefined,
  );
  io.input.isTTY = false;
  assert.equal(
    createMouseInputAdapter({
      enabled: true,
      input: io.input,
      output: io.output,
    }),
    undefined,
  );
});

interface TtyInput extends PassThrough {
  isTTY: boolean;
  setRawMode: (enabled: boolean) => TtyInput;
  ref: () => TtyInput;
  unref: () => TtyInput;
}

interface TtyOutput extends PassThrough {
  isTTY: boolean;
}

function createTtyIo(): {
  input: TtyInput;
  output: TtyOutput;
  rawModes: boolean[];
  refs: number;
  unrefs: number;
  terminalOutput: () => string;
} {
  const input = new PassThrough() as TtyInput;
  const output = new PassThrough() as TtyOutput;
  const rawModes: boolean[] = [];
  const terminalChunks: Buffer[] = [];
  const io = {
    input,
    output,
    rawModes,
    refs: 0,
    unrefs: 0,
    terminalOutput: () => Buffer.concat(terminalChunks).toString('utf8'),
  };
  input.isTTY = true;
  output.isTTY = true;
  input.setRawMode = (enabled) => {
    rawModes.push(enabled);
    return input;
  };
  input.ref = () => {
    io.refs += 1;
    return input;
  };
  input.unref = () => {
    io.unrefs += 1;
    return input;
  };
  output.on('data', (chunk: Buffer) => terminalChunks.push(Buffer.from(chunk)));
  return io;
}

function collect(stream: PassThrough): Buffer[] {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  return chunks;
}

function join(chunks: Buffer[]): string {
  return Buffer.concat(chunks).toString('utf8');
}

function writeSlices(input: PassThrough, value: Buffer, ends: number[]): void {
  let start = 0;
  for (const end of ends) {
    input.write(value.subarray(start, end));
    start = end;
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
