const MAX_WRAP_INPUT_CHARS = 20_000;
const MAX_WRAP_CHUNKS = 600;

export function wrapText(text: string, width: number): string[] {
  if (text.length === 0) return [''];
  const bounded = boundWrapInput(text);
  const chunks: string[] = [];
  for (const line of bounded.split('\n')) appendWrappedLine(chunks, line, width);
  return chunks;
}

function boundWrapInput(text: string): string {
  if (text.length <= MAX_WRAP_INPUT_CHARS) return text;
  const suffix = '\n[truncated for display]';
  return `${text.slice(0, MAX_WRAP_INPUT_CHARS - suffix.length)}${suffix}`;
}

function appendWrappedLine(chunks: string[], line: string, width: number): void {
  if (line.length === 0) {
    chunks.push('');
    return;
  }
  let rest = line;
  while (rest.length > width) {
    if (stopWrapping(chunks)) return;
    const breakAt = softBreak(rest, width);
    chunks.push(rest.slice(0, breakAt).trimEnd());
    rest = rest.slice(breakAt).trimStart();
  }
  chunks.push(rest);
}

function stopWrapping(chunks: string[]): boolean {
  if (chunks.length < MAX_WRAP_CHUNKS) return false;
  chunks.push('[truncated for display]');
  return true;
}

function softBreak(text: string, width: number): number {
  const slice = text.slice(0, width + 1);
  const whitespace = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\t'));
  return whitespace > Math.floor(width * 0.45) ? whitespace : width;
}
