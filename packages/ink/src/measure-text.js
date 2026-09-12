import widestLine from 'widest-line';
import { TextCache } from './text-cache.js';

const cache = new TextCache();
export default function measureText(text) {
  if (text.length === 0) return { width: 0, height: 0 };
  const cached = cache.get(text);
  if (cached) return cached;
  const result = { width: widestLine(text), height: text.split('\n').length };
  cache.set(text, result);
  return result;
}
