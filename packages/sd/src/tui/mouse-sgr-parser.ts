import {
  matchFixedSequence,
  matchMouseSequence,
  trailingPrefixLength,
} from './mouse-sgr-sequences.js';
import { wheelTicksForButton } from './mouse-wheel-coalescer.js';

const ESC = 0x1b;
const BRACKETED_PASTE_START = Buffer.from('\x1b[200~');
const BRACKETED_PASTE_END = Buffer.from('\x1b[201~');

export interface MouseParseResult {
  output: Buffer;
  wheelTicks: number;
}

export class MouseSgrParser {
  private pending: Buffer = Buffer.alloc(0);
  private inBracketedPaste = false;

  get shouldFlushPending(): boolean {
    return this.pending.length === 1 && !this.inBracketedPaste;
  }

  push(chunk: Buffer): MouseParseResult {
    const input = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = Buffer.alloc(0);
    return this.parse(input);
  }

  flush(): Buffer {
    const output = this.pending;
    this.reset();
    return output;
  }

  reset(): void {
    this.pending = Buffer.alloc(0);
    this.inBracketedPaste = false;
  }

  private parse(input: Buffer): MouseParseResult {
    const output: Buffer[] = [];
    let wheelTicks = 0;
    let offset = 0;

    while (offset < input.length) {
      if (this.inBracketedPaste) {
        const pasteEnd = input.indexOf(BRACKETED_PASTE_END, offset);
        if (pasteEnd >= 0) {
          const end = pasteEnd + BRACKETED_PASTE_END.length;
          output.push(input.subarray(offset, end));
          offset = end;
          this.inBracketedPaste = false;
          continue;
        }
        const keep = trailingPrefixLength(input.subarray(offset), BRACKETED_PASTE_END);
        output.push(input.subarray(offset, input.length - keep));
        this.pending = copyPending(input, input.length - keep);
        break;
      }

      const escapeIndex = input.indexOf(ESC, offset);
      if (escapeIndex < 0) {
        output.push(input.subarray(offset));
        break;
      }
      if (escapeIndex > offset) output.push(input.subarray(offset, escapeIndex));

      const pasteStart = matchFixedSequence(input, escapeIndex, BRACKETED_PASTE_START);
      if (pasteStart === 'complete') {
        output.push(input.subarray(escapeIndex, escapeIndex + BRACKETED_PASTE_START.length));
        offset = escapeIndex + BRACKETED_PASTE_START.length;
        this.inBracketedPaste = true;
        continue;
      }
      if (pasteStart === 'partial') {
        this.pending = copyPending(input, escapeIndex);
        break;
      }

      const mouse = matchMouseSequence(input, escapeIndex);
      if (mouse.state === 'complete') {
        if (!mouse.released) wheelTicks += wheelTicksForButton(mouse.button);
        offset = mouse.end;
        continue;
      }
      if (mouse.state === 'partial') {
        this.pending = copyPending(input, escapeIndex);
        break;
      }

      output.push(input.subarray(escapeIndex, escapeIndex + 1));
      offset = escapeIndex + 1;
    }

    return { output: Buffer.concat(output), wheelTicks };
  }
}

function copyPending(input: Buffer, offset: number): Buffer {
  return Buffer.from(input.subarray(offset));
}
