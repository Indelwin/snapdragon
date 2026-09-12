import type { RecordLineReaderOptions } from './record-line-types.js';

export interface PendingLine {
  head: string;
  tail: string;
  mode: 'undecided' | 'retain' | 'bounded';
  truncated: boolean;
}

export function emptyPendingLine(): PendingLine {
  return { head: '', tail: '', mode: 'undecided', truncated: false };
}

export function appendLineFragment(
  pending: PendingLine,
  fragment: string,
  options: RecordLineReaderOptions,
): void {
  if (!fragment) return;
  if (pending.mode === 'retain' || options.maxLineChars === undefined) {
    pending.head += fragment;
    return;
  }
  const limit = Math.max(1, Math.floor(options.maxLineChars));
  const available = Math.max(0, limit - pending.head.length);
  const retained = fragment.slice(0, available);
  pending.head += retained;
  const decision = options.retainFullLine?.(pending.head);
  if (decision === true) {
    retainRemainingFragment(pending, fragment.slice(retained.length));
    return;
  }
  if (decision === false || pending.head.length >= limit) pending.mode = 'bounded';
  const omitted = fragment.slice(retained.length);
  if (omitted) pending.truncated = true;
  appendTail(pending, omitted, options.tailLineChars);
}

export function visitPendingLine(
  pending: PendingLine,
  visit: (line: string, truncated: boolean) => void,
): void {
  const trimmed = `${pending.head}${pending.tail}`.trim();
  if (trimmed) visit(trimmed, pending.truncated);
}

function retainRemainingFragment(pending: PendingLine, fragment: string): void {
  pending.mode = 'retain';
  pending.head += fragment;
  pending.tail = '';
  pending.truncated = false;
}

function appendTail(pending: PendingLine, fragment: string, limitValue: number | undefined): void {
  if (!fragment || !limitValue || limitValue <= 0) return;
  pending.tail = `${pending.tail}${fragment}`.slice(-Math.floor(limitValue));
}
