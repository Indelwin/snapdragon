export function clampToolResult(content: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return content;
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content;
  const slice = Buffer.from(content, 'utf8').subarray(0, Math.floor(maxBytes)).toString('utf8');
  return `${slice}\n[tool result truncated to ${Math.floor(maxBytes)} bytes]`;
}
