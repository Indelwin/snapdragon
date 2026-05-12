const MIN_PREVIEW_CHARS = 256;

export function fallbackArgsJson(
  argsJson: string,
  originalBytes: number,
  maxBytes: number,
): string {
  let previewChars = Math.max(MIN_PREVIEW_CHARS, maxBytes - 256);
  while (previewChars >= MIN_PREVIEW_CHARS) {
    const encoded = JSON.stringify({
      _snapdragon_args_truncated: true,
      original_bytes: originalBytes,
      preview: argsJson.slice(0, previewChars),
    });
    if (Buffer.byteLength(encoded, 'utf8') <= maxBytes) return encoded;
    previewChars = Math.floor(previewChars / 2);
  }
  return JSON.stringify({ _snapdragon_args_truncated: true, original_bytes: originalBytes });
}
