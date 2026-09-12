import cliTruncate from 'cli-truncate';
import wrapAnsi from 'wrap-ansi';
import { TextCache } from './text-cache.js';

const cache = new TextCache();
export default function wrapText(text, maxWidth, wrapType) {
  const key = JSON.stringify([maxWidth, wrapType, text]);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let result = text;
  if (wrapType === 'wrap' || wrapType === 'hard') {
    result = wrapAnsi(text, maxWidth, {
      trim: false,
      hard: true,
      ...(wrapType === 'hard' ? { wordWrap: false } : {}),
    });
  }
  if (wrapType.startsWith('truncate')) {
    const position =
      wrapType === 'truncate-middle' ? 'middle' : wrapType === 'truncate-start' ? 'start' : 'end';
    result = cliTruncate(text, maxWidth, { position });
  }
  cache.set(key, result);
  return result;
}
